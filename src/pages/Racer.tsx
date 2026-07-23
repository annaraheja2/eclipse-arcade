import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSE_LIST, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { loadCourse } from '../lib/content'
import {
  stepRace, rank, placementOf, raceScore, aiTuningsFor, trackFraction, applyAnswer, ordinal,
  RACE_SECONDS, COUNTDOWN_SECONDS, START_MPH, MAX_MPH,
  type Car, type PlayerCar, type AiCar,
} from '../lib/racer'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer, resolveCourseId, levelFromXp } from '../lib/player'
import { isReducedMotion } from '../lib/motion'
import { ArrowLeft, Volume, VolumeMute, Flag, Coin, Bolt, Replay } from '../icons'
import { sfxPick, sfxDeny, sfxWin, setMuted, isMuted } from '../lib/sound'

const ACCENT = '#4d8dff'
const PLAYER_ID = 'you'
const CAR_W = 52 // px — the sprite width; the track maps distance to [0, laneWidth − CAR_W]
const FINISH_MS = 2400 // finish-flourish window before the results screen
const AI_META = [
  { id: 'ai-1', name: 'NOVA', color: '#ff3df0' },
  { id: 'ai-2', name: 'BLAZE', color: '#ffb43d' },
  { id: 'ai-3', name: 'VOLT', color: '#3dffa2' },
] as const

type Phase = 'course' | 'build' | 'race' | 'results'
type Stage = 'countdown' | 'running' | 'finish'
type Flash = { dir: 'up' | 'down'; nonce: number }
interface RaceResult { rewards: { xp: number; coins: number; best: boolean }; place: number; score: number; ranked: Car[] }

const subKey = (unitId: string, subId: string) => `${unitId}/${subId}`

/** Combined reduced-motion preference: OS setting OR the in-app Settings toggle. */
function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function shuffle<T>(arr: readonly T[]): T[] {
  const pool = [...arr]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

// A mixed set has no single difficulty — take the question-weighted average and
// snap it back to a band so the AI field scales with what the player picked.
function aggregateDifficulty(subs: Subunit[]): Difficulty {
  const rankOf: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 }
  let total = 0
  let weight = 0
  for (const s of subs) { total += rankOf[s.difficulty] * s.questions.length; weight += s.questions.length }
  if (weight === 0) return 'medium'
  const avg = total / weight
  return avg <= 0.5 ? 'easy' : avg >= 1.5 ? 'hard' : 'medium'
}

function buildCars(difficulty: Difficulty): Car[] {
  const player: PlayerCar = { kind: 'player', id: PLAYER_ID, name: 'YOU', color: ACCENT, speed: START_MPH, distance: 0 }
  const tunings = aiTuningsFor(difficulty)
  const ais: AiCar[] = tunings.map((t, i) => ({
    kind: 'ai', id: AI_META[i].id, name: AI_META[i].name, color: AI_META[i].color,
    speed: START_MPH, distance: 0,
    correctRate: t.correctRate, cadenceMin: t.cadenceMin, cadenceMax: t.cadenceMax,
    cooldown: t.cadenceMin + Math.random() * (t.cadenceMax - t.cadenceMin),
  }))
  return [player, ...ais]
}

export default function Racer() {
  const navigate = useNavigate()
  const { player, finishGame, recordAnswer } = usePlayer()
  const preferredCourseId = resolveCourseId(player.preferredCourseId)

  const [ph, setPh] = useState<Phase>('course')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [cars, setCars] = useState<Car[]>([])
  const [stage, setStage] = useState<Stage>('countdown')
  const [countNum, setCountNum] = useState(COUNTDOWN_SECONDS)
  const [timeLeft, setTimeLeft] = useState(RACE_SECONDS)
  const [q, setQ] = useState<Question | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [muted, setMutedState] = useState(isMuted())

  // ----- simulation refs (authoritative; the rAF loop reads/writes these) -----
  const carsRef = useRef<Car[]>([])
  const poolRef = useRef<Question[]>([])
  const poolIdxRef = useRef(0)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  const lastRef = useRef(0)
  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const reducedRef = useRef(false)
  const finishTimerRef = useRef(0)
  const flashTimerRef = useRef(0)

  // Load the picked course (loadCourse always resolves — bundled fallback).
  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    setCourse(null)
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [courseId])

  // Tear the race down on unmount / navigation so no rAF or timer outlives us.
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    window.clearTimeout(finishTimerRef.current)
    window.clearTimeout(flashTimerRef.current)
  }, [])

  // ---- set builder (multi-select up to 4 question-bearing subunits) ----
  const bearingKeys = course
    ? course.units.flatMap((u) => u.subunits.filter((s) => s.questions.length > 0).map((s) => subKey(u.id, s.id)))
    : []
  const selectedSubs: Subunit[] = course
    ? course.units.flatMap((u) => u.subunits.filter((s) => selected.has(subKey(u.id, s.id))))
    : []
  const questionCount = selectedSubs.reduce((n, s) => n + s.questions.length, 0)
  const atMax = selected.size >= 4

  function toggleSub(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else { if (next.size >= 4) return prev; next.add(key) }
      return next
    })
  }

  // ---- race lifecycle ----
  function frame(now: number) {
    const elapsed = (now - startRef.current) / 1000
    if (elapsed < COUNTDOWN_SECONDS) {
      setCountNum(Math.ceil(COUNTDOWN_SECONDS - elapsed))
      lastRef.current = now
      rafRef.current = requestAnimationFrame(frame)
      return
    }
    if (!runningRef.current) { runningRef.current = true; setStage('running'); lastRef.current = now }
    const raceT = elapsed - COUNTDOWN_SECONDS
    const dt = Math.min((now - lastRef.current) / 1000, 0.1) // clamp: a backgrounded tab shouldn't leap
    lastRef.current = now
    const next = stepRace(carsRef.current, dt, Math.random)
    carsRef.current = next
    setCars(next)
    setTimeLeft(Math.max(0, RACE_SECONDS - raceT))
    if (raceT >= RACE_SECONDS) { endRace(); return }
    rafRef.current = requestAnimationFrame(frame)
  }

  function endRace() {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (reducedRef.current) { finalize(); return }
    setStage('finish') // cars sprint across the line in rank order, then results
    finishTimerRef.current = window.setTimeout(finalize, FINISH_MS)
  }

  function finalize() {
    if (finishedRef.current) return
    finishedRef.current = true
    const finalCars = carsRef.current
    const place = placementOf(finalCars, PLAYER_ID)
    const me = finalCars.find((c) => c.id === PLAYER_ID)
    const score = me ? raceScore(me.distance, place) : 0
    const rewards = finishGame('racer', score)
    if (place === 1) sfxWin()
    setResult({ rewards, place, score, ranked: rank(finalCars) })
    setPh('results')
  }

  function startRace() {
    const subs = selectedSubs.filter((s) => s.questions.length > 0)
    const pool = shuffle(subs.flatMap((s) => s.questions))
    if (pool.length === 0) return
    poolRef.current = pool
    poolIdxRef.current = 1
    const cars0 = buildCars(aggregateDifficulty(subs))
    carsRef.current = cars0
    setCars(cars0)
    finishedRef.current = false
    runningRef.current = false
    reducedRef.current = prefersReducedMotion()
    setResult(null)
    setStage('countdown')
    setCountNum(COUNTDOWN_SECONDS)
    setTimeLeft(RACE_SECONDS)
    setFlash(null)
    setQ({ ...pool[0] })
    setPh('race')
    startRef.current = performance.now()
    lastRef.current = startRef.current
    rafRef.current = requestAnimationFrame(frame)
  }

  function nextQuestion() {
    const pool = poolRef.current
    if (pool.length === 0) return
    const picked = pool[poolIdxRef.current % pool.length]
    poolIdxRef.current += 1
    setQ({ ...picked }) // fresh identity → QuestionPanel resets its inputs
  }

  // Stable across the 60fps re-renders so the memoized question card doesn't churn.
  const onAnswer = useCallback((correct: boolean) => {
    if (!runningRef.current) return
    recordAnswer(correct)
    carsRef.current = carsRef.current.map((c) => (c.kind === 'player' ? { ...c, speed: applyAnswer(c.speed, correct) } : c))
    setCars(carsRef.current)
    if (correct) sfxPick(); else sfxDeny()
    setFlash({ dir: correct ? 'up' : 'down', nonce: Date.now() })
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 750)
    nextQuestion()
  }, [recordAnswer])

  function abandonRace() {
    cancelAnimationFrame(rafRef.current)
    window.clearTimeout(finishTimerRef.current)
    runningRef.current = false
    finishedRef.current = true
  }
  function goBack() {
    if (ph === 'course') { navigate('/'); return }
    if (ph === 'build') { setPh('course'); return }
    if (ph === 'race') { abandonRace(); setPh('build'); return }
    navigate('/')
  }

  const timerLabel = formatClock(timeLeft)
  const timerColor = timeLeft <= 10 ? '#ff4d8d' : timeLeft <= 30 ? '#ffb43d' : '#e9edff'

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={goBack} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          {ph === 'race'
            ? <div className="font-pixel text-lg tabular-nums" style={{ color: timerColor }} aria-live="off">{timerLabel}</div>
            : <div className="font-pixel text-[12px]" style={{ color: ACCENT }}>RACER</div>}
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>

        {ph === 'course' && (
          <Section title="CHOOSE A COURSE">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id} onClick={() => { setCourseId(c.id); setSelected(new Set()); setPh('build') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className={`text-left rounded-xl border bg-white/[0.03] p-4 transition ${preferred ? 'border-neon-blue/70' : 'border-white/10 hover:border-neon-blue/60'}`}
                    style={preferred ? { borderColor: `${ACCENT}b0` } : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{c.name}</span>
                      {preferred && <span className="shrink-0 font-pixel text-[8px] px-2 py-1 rounded" style={{ background: `${ACCENT}22`, color: ACCENT }}>YOUR LEVEL</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {ph === 'build' && !course && (
          <p className="text-center text-white/70 font-pixel text-[10px] py-16">LOADING COURSE…</p>
        )}

        {ph === 'build' && course && (
          <SetBuilder
            course={course}
            selected={selected}
            atMax={atMax}
            questionCount={questionCount}
            canSelectAll={bearingKeys.length > 0}
            onToggle={toggleSub}
            onSelectAll={() => setSelected(new Set(bearingKeys.slice(0, 4)))}
            onClear={() => setSelected(new Set())}
            onStart={startRace}
          />
        )}

        {ph === 'race' && (
          <div>
            <StandingsBar cars={cars} />
            <div className="relative mt-4">
              <RaceTrack cars={cars} stage={stage} reduced={reducedRef.current} />
              {stage === 'countdown' && <CountdownOverlay n={countNum} />}
            </div>

            <div className="relative -mt-5 sm:-mt-7 px-2 sm:px-8 pb-2">
              {flash && (
                <div key={flash.nonce} className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 font-pixel text-[11px] px-2.5 py-1 rounded"
                  style={{ background: flash.dir === 'up' ? '#0c3b24' : '#3b0c1e', color: flash.dir === 'up' ? '#3dffa2' : '#ff8fb0' }}>
                  {flash.dir === 'up' ? '+2 MPH' : '−2 MPH'}
                </div>
              )}
              {stage === 'running' && q
                ? <RaceQuestion q={q} color={ACCENT} onSubmit={onAnswer} surface="light" label="ANSWER TO ACCELERATE" />
                : <div className="rounded-2xl bg-white p-6 text-center shadow-[0_10px_40px_-8px_rgba(0,0,0,0.65)] ring-1 ring-black/10">
                    <div className="font-pixel text-[12px]" style={{ color: '#5b2ec9' }}>
                      {stage === 'finish' ? 'PHOTO FINISH' : 'GET READY'}
                    </div>
                    <p className="mt-2 text-[#0a0620]/70 text-sm">
                      {stage === 'finish' ? 'Crossing the line…' : 'The flag drops in a moment — answer fast to accelerate.'}
                    </p>
                  </div>}
            </div>
            <p className="text-center text-[11px] text-white/35 mt-4">Correct answer +2 MPH · wrong −2 MPH · your car cruises on its own</p>
          </div>
        )}

        {ph === 'results' && result && (
          <Results
            result={result}
            level={levelFromXp(player.xp).level}
            onAgain={startRace}
            onPick={() => setPh('build')}
            onHome={() => navigate('/')}
          />
        )}
      </div>
    </div>
  )
}

const RaceQuestion = memo(QuestionPanel)

// ---------------------------------------------------------------------------

function formatClock(secs: number): string {
  const s = Math.ceil(secs)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-pixel text-[11px] tracking-wider neon-text mb-5 text-center" style={{ color: ACCENT }}>{title}</h2>{children}</div>
}

function DiffBadge({ d }: { d: Difficulty }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[9px] font-pixel px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}

// ---- set builder ----
function SetBuilder({ course, selected, atMax, questionCount, canSelectAll, onToggle, onSelectAll, onClear, onStart }: {
  course: Course; selected: Set<string>; atMax: boolean; questionCount: number; canSelectAll: boolean
  onToggle: (key: string) => void; onSelectAll: () => void; onClear: () => void; onStart: () => void
}) {
  const canStart = selected.size > 0 && questionCount > 0
  return (
    <Section title="BUILD YOUR QUESTION SET">
      <p className="text-center text-sm text-white/60 mb-4">Pick up to 4 topics from any units. The race draws from all of them, shuffled.</p>
      <div className="flex flex-wrap items-center justify-center gap-3 mb-5">
        <span className="font-pixel text-[10px]" style={{ color: ACCENT }}>{selected.size}/4 TOPICS · {questionCount} QUESTIONS</span>
        <button onClick={onSelectAll} disabled={!canSelectAll}
          className="font-pixel text-[9px] px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">SELECT ALL</button>
        <button onClick={onClear} disabled={selected.size === 0}
          className="font-pixel text-[9px] px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">CLEAR</button>
      </div>

      {course.units.every((u) => u.subunits.every((s) => s.questions.length === 0)) ? (
        <p className="text-center text-sm text-white/60 py-8">This course has no authored questions yet — pick another course.</p>
      ) : (
        <div className="grid gap-5">
          {course.units.filter((u) => u.subunits.length > 0).map((u) => (
            <div key={u.id}>
              <div className="font-bold text-white/90 mb-2">{u.name}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {u.subunits.map((s) => {
                  const key = subKey(u.id, s.id)
                  const checked = selected.has(key)
                  const empty = s.questions.length === 0
                  const blocked = !checked && atMax
                  const disabled = empty || blocked
                  const hint = empty ? 'No questions yet' : blocked ? 'Max 4 topics' : `${s.questions.length} questions`
                  return (
                    <button key={s.id} role="checkbox" aria-checked={checked} aria-disabled={disabled}
                      onClick={() => { if (!disabled) onToggle(key) }}
                      className={`flex items-center gap-3 text-left rounded-xl border p-3 transition ${disabled ? 'opacity-45 cursor-default' : 'hover:border-neon-blue/60'}`}
                      style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.1)', background: checked ? `${ACCENT}14` : 'rgba(255,255,255,0.03)' }}>
                      <span aria-hidden className="grid place-items-center w-5 h-5 rounded-md border shrink-0"
                        style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.3)', background: checked ? ACCENT : 'transparent' }}>
                        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a0620" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{s.name}</span>
                          <DiffBadge d={s.difficulty} />
                        </span>
                        <span className="block text-xs text-white/55 mt-0.5">{hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-7 flex flex-col items-center gap-2">
        <button onClick={onStart} disabled={!canStart}
          className="font-pixel text-[12px] px-7 py-3.5 rounded-xl text-[#0a0620] disabled:opacity-40 transition"
          style={{ background: ACCENT, boxShadow: canStart ? `0 0 20px ${ACCENT}88` : 'none' }}>
          START RACE
        </button>
        {!canStart && <span className="text-xs text-white/50">Select at least one topic to start.</span>}
      </div>
    </Section>
  )
}

// ---- persistent standings strip ----
function StandingsBar({ cars }: { cars: Car[] }) {
  const ranked = rank(cars)
  const place = placementOf(cars, PLAYER_ID)
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-pixel text-[9px] text-white/60">STANDINGS</span>
        <span className="font-pixel text-[10px]" style={{ color: ACCENT }} aria-live="polite">
          YOU'RE {ordinal(place).toUpperCase()} OF {cars.length}
        </span>
      </div>
      <div className="relative h-5 mx-1" aria-hidden>
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/12" />
        <div className="absolute right-0 top-0 bottom-0 w-0.5 rounded bg-white/30" />
        {cars.map((c) => {
          const isP = c.id === PLAYER_ID
          const d = isP ? 15 : 11
          return (
            <span key={c.id} className="absolute top-1/2 rounded-full"
              style={{
                left: `${trackFraction(c.distance) * 100}%`, width: d, height: d,
                transform: 'translate(-50%, -50%)', background: c.color,
                boxShadow: `0 0 8px ${c.color}`, outline: isP ? '2px solid #fff' : 'none', zIndex: isP ? 2 : 1,
              }} />
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {ranked.map((c, i) => {
          const isP = c.id === PLAYER_ID
          return (
            <span key={c.id} className={`inline-flex items-center gap-1.5 text-[11px] ${isP ? 'font-bold text-white' : 'text-white/70'}`}>
              <span className="font-pixel text-[8px] text-white/45">P{i + 1}</span>
              <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
              {c.name}
              <span className="tabular-nums text-white/60">{Math.round(c.speed)} MPH</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ---- the track ----
function RaceTrack({ cars, stage, reduced }: { cars: Car[]; stage: Stage; reduced: boolean }) {
  const ranked = rank(cars)
  const placeIndex: Record<string, number> = {}
  ranked.forEach((c, i) => { placeIndex[c.id] = i })
  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 px-4 py-3"
      style={{ background: 'radial-gradient(120% 100% at 50% -10%, rgba(77,141,255,0.14), transparent 60%), linear-gradient(180deg, #0d0930, #0a0620)' }}>
      {/* start + finish posts (finish aligns with where a car comes to rest, flush right) */}
      <div aria-hidden className="absolute top-2 bottom-2 left-4 w-0.5 bg-white/20" />
      <div aria-hidden className="absolute top-2 bottom-2 rounded-sm" style={{ right: 16 + CAR_W, width: 6, backgroundImage: 'repeating-linear-gradient(180deg,#e9edff 0 7px,#0a0620 7px 14px)' }} />
      {cars.map((car) => {
        const isP = car.id === PLAYER_ID
        const target = stage === 'finish' ? 1 : trackFraction(car.distance)
        const delay = stage === 'finish' ? placeIndex[car.id] * 0.32 : 0
        return (
          <div key={car.id} className="relative h-16"
            style={{ background: isP ? 'linear-gradient(90deg, rgba(77,141,255,0.10), transparent)' : undefined }}>
            <div aria-hidden className="absolute left-4 right-4 bottom-0 h-px bg-white/8" />
            <div className="absolute inset-y-0 left-4 right-4">
              <div className="absolute inset-y-0 flex items-center"
                style={{
                  transform: `translateX(calc(${target} * (100% - ${CAR_W}px)))`,
                  transition: stage === 'finish' && !reduced ? `transform 1.15s cubic-bezier(0.5,0,0.2,1) ${delay}s` : 'none',
                }}>
                <div className="relative">
                  {isP && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 font-pixel text-[7px] px-1.5 py-0.5 rounded whitespace-nowrap"
                      style={{ background: ACCENT, color: '#04122e' }}>YOU</span>
                  )}
                  <CarSprite color={car.color} isPlayer={isP} />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Original side-view race car — opaque, distinct per accent, no emoji.
function CarSprite({ color, isPlayer }: { color: string; isPlayer: boolean }) {
  return (
    <svg width={CAR_W} height={CAR_W * 0.5} viewBox="0 0 60 30" aria-hidden
      style={isPlayer ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}>
      <ellipse cx="30" cy="27.5" rx="22" ry="2.4" fill="#000" opacity="0.35" />
      <path d="M3 20 Q4 13 13 12 L20 7 Q23 5 30 5 L38 5 Q45 6 50 12 L55 14 Q57 15 57 18 L57 20 Q57 22 55 22 L5 22 Q3 22 3 20Z" fill={color} />
      <path d="M21 8 L30 8 L36 12 L20 12 Z" fill="#0a0620" opacity="0.6" />
      <rect x="6" y="16" width="48" height="2" rx="1" fill="#fff" opacity="0.18" />
      <circle cx="17" cy="22" r="5.4" fill="#0a0620" /><circle cx="17" cy="22" r="2.1" fill="#c9d2ff" />
      <circle cx="43" cy="22" r="5.4" fill="#0a0620" /><circle cx="43" cy="22" r="2.1" fill="#c9d2ff" />
      <circle cx="55.5" cy="16.5" r="1.4" fill="#fff" />
    </svg>
  )
}

function CountdownOverlay({ n }: { n: number }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#0a0620]/55" aria-hidden>
      <span key={n} className="race-count font-pixel text-6xl neon-text" style={{ color: ACCENT }}>{n}</span>
    </div>
  )
}

// ---- results ----
function Results({ result, level, onAgain, onPick, onHome }: {
  result: RaceResult; level: number; onAgain: () => void; onPick: () => void; onHome: () => void
}) {
  const { place, ranked, rewards } = result
  const won = place === 1
  return (
    <div className="text-center py-8">
      <div className="flex justify-center mb-3" style={{ color: won ? ACCENT : '#ff9dbd' }}><Flag width={40} height={40} /></div>
      <div className="font-pixel text-2xl mb-1" style={{ color: won ? ACCENT : '#ff9dbd' }}>
        {won ? 'WINNER!' : `${ordinal(place).toUpperCase()} PLACE`}
      </div>
      <p className="text-white/50 mb-5">{won ? 'You took the checkered flag.' : 'Sharpen up and race again.'}</p>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-5 max-w-sm mx-auto">
        {ranked.map((c, i) => (
          <div key={c.id} className={`flex items-center justify-between py-1.5 text-sm ${c.id === PLAYER_ID ? 'font-bold text-white' : 'text-white/70'}`}>
            <span className="flex items-center gap-2">
              <span className="font-pixel text-[9px] text-white/45 w-6">P{i + 1}</span>
              <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
              {c.name}
            </span>
            <span className="tabular-nums text-white/60">{Math.round(trackFraction(c.distance) * 100)}%</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-3 mb-2">
        <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-neon-amber font-semibold"><Coin width={18} height={18} /> +{rewards.coins}</span>
        <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 font-semibold" style={{ color: ACCENT }}><Bolt width={18} height={18} /> +{rewards.xp} XP</span>
      </div>
      {rewards.best && <div className="inline-block font-pixel text-[9px] px-2 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2">NEW BEST!</div>}
      <div className="text-xs text-white/40 mb-6">Level {level}</div>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onAgain} className="flex items-center gap-2 font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={{ background: ACCENT, boxShadow: `0 0 18px ${ACCENT}88` }}>
          <Replay width={16} height={16} /> RACE AGAIN
        </button>
        <button onClick={onPick} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/15">NEW SET</button>
        <button onClick={onHome} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">ARCADE</button>
      </div>
    </div>
  )
}
