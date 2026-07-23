import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSE_LIST, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { loadCourse } from '../lib/content'
import {
  stepRace, rank, placementOf, raceScore, aiTuningsFor, initialCooldown, trackFraction, applyAnswer, ordinal,
  RACE_SECONDS, COUNTDOWN_SECONDS, START_MPH,
  type Car, type PlayerCar, type AiCar,
} from '../lib/racer'
import { startLights, gapSeconds, formatGap, speedIntensity, lapOf, type StartLights } from '../lib/circuit'
import Circuit, { type CircuitHandle } from '../components/Circuit'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer, resolveCourseId, levelFromXp } from '../lib/player'
import { isReducedMotion } from '../lib/motion'
import { ArrowLeft, Volume, VolumeMute, Coin, Bolt, Replay } from '../icons'
import { sfxPick, sfxDeny, sfxWin, sfxFire, sfxRotate, setMuted, isMuted } from '../lib/sound'

const ACCENT = '#4d8dff' // the player's team colour (matches the Racer cabinet)
const PLAYER_ID = 'you'
const FINISH_MS = 2400 // chequered-flag flourish before the results screen
const HUD_MS = 125 // HUD state refresh — ~8Hz, so React never re-renders at 60fps
const GO_MS = 600 // how long "GO GO GO" holds after the lights go out
// Rival liveries read as constructor teams, not neon: scarlet, papaya, green.
const AI_META = [
  { id: 'ai-1', name: 'NOVA', color: '#e4322b' },
  { id: 'ai-2', name: 'BLAZE', color: '#ff9f1c' },
  { id: 'ai-3', name: 'VOLT', color: '#00c48c' },
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
    cooldown: initialCooldown(t, Math.random),
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

  // The field's identities, set once per race — a stable prop so the memoised
  // Circuit never re-renders while the HUD ticks.
  const [field, setField] = useState<Car[]>([])
  // HUD-only mirrors of the sim — refreshed at HUD_MS, never per frame.
  const [cars, setCars] = useState<Car[]>([])
  const [timeLeft, setTimeLeft] = useState(RACE_SECONDS)
  const [stage, setStage] = useState<Stage>('countdown')
  const [lights, setLights] = useState<StartLights>({ kind: 'arming', lit: 0 })
  const [goFlash, setGoFlash] = useState(false)
  const [q, setQ] = useState<Question | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [muted, setMutedState] = useState(isMuted())

  // ----- simulation refs (authoritative; the rAF loop reads/writes these) -----
  const circuitRef = useRef<CircuitHandle>(null)
  const carsRef = useRef<Car[]>([])
  const poolRef = useRef<Question[]>([])
  const poolIdxRef = useRef(0)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  const lastRef = useRef(0)
  const hudRef = useRef(0)
  const lampRef = useRef(-1)
  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const reducedRef = useRef(false)
  const finishTimerRef = useRef(0)
  const flashTimerRef = useRef(0)
  const goTimerRef = useRef(0)

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
    window.clearTimeout(goTimerRef.current)
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
      const next = startLights(elapsed)
      if (next.kind === 'arming' && next.lit !== lampRef.current) {
        lampRef.current = next.lit
        setLights(next)
        if (next.lit > 0) sfxRotate()
      }
      circuitRef.current?.render(carsRef.current, PLAYER_ID)
      lastRef.current = now
      rafRef.current = requestAnimationFrame(frame)
      return
    }
    if (!runningRef.current) {
      runningRef.current = true
      setStage('running')
      setLights({ kind: 'go' })
      setGoFlash(true)
      goTimerRef.current = window.setTimeout(() => setGoFlash(false), GO_MS)
      sfxFire()
      lastRef.current = now
    }
    const raceT = elapsed - COUNTDOWN_SECONDS
    const dt = Math.min((now - lastRef.current) / 1000, 0.1) // clamp: a backgrounded tab shouldn't leap
    lastRef.current = now
    const next = stepRace(carsRef.current, dt, Math.random)
    carsRef.current = next
    circuitRef.current?.render(next, PLAYER_ID)
    if (now - hudRef.current >= HUD_MS) {
      hudRef.current = now
      setCars(next)
      setTimeLeft(Math.max(0, RACE_SECONDS - raceT))
    }
    if (raceT >= RACE_SECONDS) { endRace(); return }
    rafRef.current = requestAnimationFrame(frame)
  }

  function endRace() {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    setCars(carsRef.current)
    setTimeLeft(0)
    if (reducedRef.current) { finalize(); return }
    setStage('finish') // the chequered flag sweeps past while the world rolls to a stop
    circuitRef.current?.coastToStop(carsRef.current.find((c) => c.id === PLAYER_ID)?.speed ?? 0)
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
    setField(cars0)
    setCars(cars0)
    finishedRef.current = false
    runningRef.current = false
    reducedRef.current = prefersReducedMotion()
    lampRef.current = -1
    hudRef.current = 0
    setResult(null)
    setStage('countdown')
    setLights({ kind: 'arming', lit: 0 })
    setGoFlash(false)
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

  // Stable across renders so the memoized question card doesn't churn.
  const onAnswer = useCallback((correct: boolean) => {
    if (!runningRef.current) return
    recordAnswer(correct)
    carsRef.current = carsRef.current.map((c) => (c.kind === 'player' ? { ...c, speed: applyAnswer(c.speed, correct) } : c))
    setCars(carsRef.current)
    if (correct) sfxPick(); else sfxDeny()
    circuitRef.current?.pulse(correct ? 'up' : 'down')
    setFlash({ dir: correct ? 'up' : 'down', nonce: Date.now() })
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 750)
    nextQuestion()
  }, [recordAnswer])

  function abandonRace() {
    cancelAnimationFrame(rafRef.current)
    window.clearTimeout(finishTimerRef.current)
    window.clearTimeout(goTimerRef.current)
    runningRef.current = false
    finishedRef.current = true
  }
  function goBack() {
    if (ph === 'course') { navigate('/'); return }
    if (ph === 'build') { setPh('course'); return }
    if (ph === 'race') { abandonRace(); setPh('build'); return }
    navigate('/')
  }

  const you = cars.find((c) => c.id === PLAYER_ID)
  const place = placementOf(cars, PLAYER_ID)
  const lap = lapOf(you?.distance ?? 0) // derived from the 8Hz HUD mirror — no extra state
  const showGantry = stage === 'countdown' || goFlash

  return (
    // z-61 lifts Racer above the app-wide CRT scanline/vignette overlays (z-60).
    // Racer is deliberately the one broadcast-clean cabinet — see CLAUDE.md.
    <div className="min-h-screen relative font-race">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[61]"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, #1b2333 0%, #12151c 46%, #0b0d12 100%)' }} />
      <div className="relative z-[62] max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-5 gap-3">
          <button aria-label="Back" onClick={goBack}
            className="grid place-items-center w-10 h-10 rounded-lg bg-track-slate ring-1 ring-white/12 text-white/80 hover:text-white hover:bg-track-asphalt transition">
            <ArrowLeft width={18} height={18} />
          </button>
          {ph === 'race' ? <RaceClock secs={timeLeft} /> : <Marque />}
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }}
            className="grid place-items-center w-10 h-10 rounded-lg bg-track-slate ring-1 ring-white/12 text-white/80 hover:text-white hover:bg-track-asphalt transition">
            {muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}
          </button>
        </div>

        {ph === 'course' && (
          <Sheet title="CHOOSE A COURSE" sub="Pit lane — pick the championship you're racing in.">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id} onClick={() => { setCourseId(c.id); setSelected(new Set()); setPh('build') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className="group relative overflow-hidden text-left rounded-lg bg-track-slate ring-1 ring-white/10 hover:ring-white/30 transition pl-5 pr-4 py-4">
                    <span aria-hidden className="absolute left-0 top-0 bottom-0 w-2" style={{ backgroundImage: KERB_STRIPE }} />
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[17px] text-white">{c.name}</span>
                      {preferred && (
                        <span className="shrink-0 font-bold text-[9px] tracking-[0.14em] px-2 py-1 rounded"
                          style={{ background: '#0d2a5c', color: '#a9ccff' }}>HOME GRID</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </Sheet>
        )}

        {ph === 'build' && !course && (
          <p className="text-center text-white/70 font-bold tracking-[0.2em] text-[11px] py-16">LOADING COURSE…</p>
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
            {/* Only the stage escapes the page column — the overhead camera
                needs the room; the question panel below keeps its own width. */}
            <div className="relative lg:-mx-32">
              <Circuit ref={circuitRef} field={field} youId={PLAYER_ID} reduced={reducedRef.current} flagged={stage === 'finish'} />
              <TimingTower cars={cars} />
              <LapBoard lap={lap} />
              <Speedo mph={you?.speed ?? 0} />
              {showGantry && <StartGantry lights={lights} />}
              <p className="sr-only" aria-live="assertive">{lights.kind === 'go' ? 'Lights out — go' : ''}</p>
              <p className="sr-only" aria-live="polite">{`Lap ${lap} — running ${ordinal(place)} of ${cars.length}`}</p>
            </div>

            <div className="relative mt-4 px-0 sm:px-6 pb-2">
              {flash && (
                <div key={flash.nonce} className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 font-bold text-[11px] tracking-[0.12em] px-2.5 py-1 rounded shadow-lg"
                  style={{ background: flash.dir === 'up' ? '#0b3a26' : '#4a0f14', color: flash.dir === 'up' ? '#7cf0b8' : '#ffa8b4' }}>
                  {flash.dir === 'up' ? '+2 MPH' : '−2 MPH'}
                </div>
              )}
              {stage === 'running' && q
                ? <RaceQuestion q={q} color={ACCENT} onSubmit={onAnswer} surface="light" label="ANSWER TO ACCELERATE" />
                : <div className="rounded-2xl bg-white p-6 text-center shadow-[0_10px_40px_-8px_rgba(0,0,0,0.65)] ring-1 ring-black/10">
                    <div className="font-black text-[13px] tracking-[0.2em]" style={{ color: '#b81d13' }}>
                      {stage === 'finish' ? 'CHEQUERED FLAG' : 'FORMATION LAP'}
                    </div>
                    <p className="mt-2 text-[#12151c]/75 text-sm">
                      {stage === 'finish' ? 'Rolling down to the pits…' : 'Five lights, then away — answer fast to accelerate.'}
                    </p>
                  </div>}
            </div>
            <p className="text-center text-[12px] text-white/60 mt-3">Correct +2 MPH · wrong −2 MPH · your car keeps rolling on its own</p>
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

/** Red/white kerb blocks — the sheet's signature edge, reused across the setup UI. */
const KERB_STRIPE = 'repeating-linear-gradient(180deg,#e4322b 0 10px,#f4f6fa 10px 20px)'

function formatClock(secs: number): string {
  const s = Math.ceil(secs)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function Marque() {
  return (
    <span className="inline-flex items-center gap-2 font-black text-[12px] tracking-[0.26em] text-white">
      <span aria-hidden className="w-4 h-3 rounded-[2px]" style={{ backgroundImage: KERB_STRIPE, backgroundSize: '100% 6px' }} />
      RACER
    </span>
  )
}

function RaceClock({ secs }: { secs: number }) {
  const color = secs <= 10 ? '#ff8f9e' : secs <= 30 ? '#ffc46b' : '#ffffff'
  return (
    <div className="flex items-center gap-2 rounded-lg bg-track-carbon ring-1 ring-white/12 px-3 py-1.5">
      <span className="font-bold text-[9px] tracking-[0.2em] text-white/55">RACE</span>
      <span className="font-black text-[18px] leading-none tabular-nums" style={{ color }} aria-live="off">{formatClock(secs)}</span>
    </div>
  )
}

/** Setup-sheet frame for the pre-race screens — a pit-wall document, not a menu. */
function Sheet({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-stretch gap-3 mb-5">
        <span aria-hidden className="w-2 rounded-sm" style={{ backgroundImage: KERB_STRIPE }} />
        <div>
          <h2 className="font-black text-[15px] sm:text-[17px] tracking-[0.18em] text-white">{title}</h2>
          <p className="text-[13px] text-white/60 mt-0.5">{sub}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function DiffBadge({ d }: { d: Difficulty }) {
  const tone = d === 'easy'
    ? { bg: '#0c3325', fg: '#7cf0b8' }
    : d === 'medium'
      ? { bg: '#3a2a05', fg: '#ffd07a' }
      : { bg: '#43110f', fg: '#ffa89f' }
  return (
    <span className="shrink-0 text-[9px] font-bold tracking-[0.14em] px-2 py-1 rounded"
      style={{ background: tone.bg, color: tone.fg }}>{d.toUpperCase()}</span>
  )
}

// ---- set builder ----
function SetBuilder({ course, selected, atMax, questionCount, canSelectAll, onToggle, onSelectAll, onClear, onStart }: {
  course: Course; selected: Set<string>; atMax: boolean; questionCount: number; canSelectAll: boolean
  onToggle: (key: string) => void; onSelectAll: () => void; onClear: () => void; onStart: () => void
}) {
  const canStart = selected.size > 0 && questionCount > 0
  const empty = course.units.every((u) => u.subunits.every((s) => s.questions.length === 0))
  return (
    <Sheet title="SESSION SETUP" sub="Garage sheet — load up to 4 topics. The race draws from all of them, shuffled.">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 rounded-lg bg-track-carbon ring-1 ring-white/10 px-4 py-3">
        <span className="font-bold text-[11px] tracking-[0.14em] text-white/80">
          {selected.size}/4 TOPICS · <span className="tabular-nums">{questionCount}</span> QUESTIONS
        </span>
        <span className="flex gap-2">
          <button onClick={onSelectAll} disabled={!canSelectAll}
            className="font-bold text-[10px] tracking-[0.12em] px-3 py-2 rounded-md bg-track-slate ring-1 ring-white/12 text-white/85 enabled:hover:bg-track-asphalt disabled:opacity-40 transition">FILL GRID</button>
          <button onClick={onClear} disabled={selected.size === 0}
            className="font-bold text-[10px] tracking-[0.12em] px-3 py-2 rounded-md bg-track-slate ring-1 ring-white/12 text-white/85 enabled:hover:bg-track-asphalt disabled:opacity-40 transition">CLEAR</button>
        </span>
      </div>

      {empty ? (
        <p className="text-center text-sm text-white/60 py-8">This course has no authored questions yet — pick another course.</p>
      ) : (
        <div className="grid gap-5">
          {course.units.filter((u) => u.subunits.length > 0).map((u) => (
            <div key={u.id}>
              <div className="flex items-center gap-2 mb-2">
                <span aria-hidden className="w-1.5 h-4 rounded-sm bg-track-kerb" />
                <span className="font-bold text-white/90">{u.name}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {u.subunits.map((s) => {
                  const key = subKey(u.id, s.id)
                  const checked = selected.has(key)
                  const noQuestions = s.questions.length === 0
                  const blocked = !checked && atMax
                  const disabled = noQuestions || blocked
                  const hint = noQuestions ? 'No questions yet' : blocked ? 'Max 4 topics' : `${s.questions.length} questions`
                  return (
                    <button key={s.id} role="checkbox" aria-checked={checked} aria-disabled={disabled}
                      onClick={() => { if (!disabled) onToggle(key) }}
                      className={`flex items-center gap-3 text-left rounded-lg bg-track-slate ring-1 p-3 transition ${disabled ? 'opacity-45 cursor-default ring-white/10' : 'hover:ring-white/30 ring-white/10'}`}
                      style={checked ? { boxShadow: `inset 3px 0 0 ${ACCENT}`, background: '#22304a' } : undefined}>
                      <span aria-hidden className="grid place-items-center w-5 h-5 rounded-md border shrink-0"
                        style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.4)', background: checked ? ACCENT : 'transparent' }}>
                        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a1834" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{s.name}</span>
                          <DiffBadge d={s.difficulty} />
                        </span>
                        <span className="block text-xs text-white/60 mt-0.5">{hint}</span>
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
          className="font-black text-[13px] tracking-[0.2em] px-8 py-3.5 rounded-lg disabled:opacity-40 transition"
          style={{ background: ACCENT, color: '#06122b', boxShadow: canStart ? `0 6px 20px -6px ${ACCENT}` : 'none' }}>
          START RACE
        </button>
        {!canStart && <span className="text-xs text-white/60">Select at least one topic to start.</span>}
      </div>
    </Sheet>
  )
}

// ---- broadcast HUD ----
function TimingTower({ cars }: { cars: Car[] }) {
  const ranked = rank(cars)
  const leader = ranked[0]
  if (!leader) return null
  return (
    <div className="absolute left-2 top-2 sm:left-3 sm:top-3 w-[124px] sm:w-[196px] rounded-lg overflow-hidden bg-track-carbon/95 ring-1 ring-white/15 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]">
      <div className="flex items-center justify-between px-2 py-1 sm:px-2.5 sm:py-1.5 bg-track-slate">
        <span className="font-bold text-[8px] sm:text-[9px] tracking-[0.16em] sm:tracking-[0.2em] text-white/75">TIMING</span>
        <span className="font-bold text-[8px] sm:text-[9px] tracking-[0.16em] sm:tracking-[0.2em] text-track-sun">GAP</span>
      </div>
      {ranked.map((c, i) => {
        const isP = c.id === PLAYER_ID
        return (
          <div key={c.id} className={`flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-[2px] sm:py-[3px] ${isP ? 'bg-white/[0.14]' : ''}`}>
            <span className="font-black text-[9px] sm:text-[10px] tabular-nums text-white/60 w-3 sm:w-3.5">{i + 1}</span>
            <span aria-hidden className="w-[3px] h-3.5 sm:h-4 rounded-[1px] shrink-0" style={{ background: c.color }} />
            <span className={`font-bold text-[9px] sm:text-[11px] tracking-wide flex-1 truncate ${isP ? 'text-white' : 'text-white/85'}`}>{c.name}</span>
            <span className="font-semibold text-[9px] sm:text-[10px] tabular-nums text-white/75">
              {i === 0 ? 'LEADER' : formatGap(gapSeconds(leader.distance - c.distance, c.speed))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Lap counter, top-right opposite the timing tower. Keying on `lap` remounts
 * the board as the counter turns over, replaying the crossing pulse — gated
 * off lap 1 so the initial mount doesn't fire it.
 */
function LapBoard({ lap }: { lap: number }) {
  return (
    <div key={lap} className={`absolute right-2 top-2 sm:right-3 sm:top-3 rounded-lg bg-track-carbon/95 ring-1 ring-white/15 px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]${lap > 1 ? ' rc-lap-new' : ''}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-bold text-[9px] sm:text-[10px] tracking-[0.2em] text-track-sun">LAP</span>
        <span className="font-black text-[18px] sm:text-[22px] leading-none tabular-nums text-white">{lap}</span>
      </div>
    </div>
  )
}

function Speedo({ mph }: { mph: number }) {
  const pct = speedIntensity(mph) * 100
  return (
    <div className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 rounded-lg bg-track-carbon/95 ring-1 ring-white/15 px-2.5 sm:px-3 pt-1 sm:pt-1.5 pb-1.5 sm:pb-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]">
      <div className="flex items-baseline justify-end gap-1.5">
        <span className="font-black text-[22px] sm:text-[30px] leading-none tabular-nums text-white">{Math.round(mph)}</span>
        <span className="font-bold text-[9px] sm:text-[10px] tracking-[0.2em] text-track-sun">MPH</span>
      </div>
      <div aria-hidden className="mt-1 sm:mt-1.5 h-1.5 w-[64px] sm:w-[92px] rounded-full bg-white/15 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg,${ACCENT},#ffd76a 78%,#e4322b)` }} />
      </div>
    </div>
  )
}

/** The five-light start gantry: lamps fill left→right, then all extinguish. */
function StartGantry({ lights }: { lights: StartLights }) {
  const go = lights.kind === 'go'
  return (
    <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center pb-[16%] px-6" style={{ background: 'rgba(9,11,16,0.46)' }}>
      <div className="w-[58%] max-w-[236px]">
        <div className="rounded-md bg-track-carbon ring-1 ring-white/15 px-2.5 py-2 shadow-[0_14px_36px_-10px_rgba(0,0,0,0.95)]">
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {[0, 1, 2, 3, 4].map((i) => {
              const on = !go && lights.lit > i
              return (
                <div key={i} className="grid gap-1">
                  <span className={`rc-lamp${on ? ' is-lit' : ''}`} />
                  <span className={`rc-lamp${on ? ' is-lit' : ''}`} />
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex justify-between px-2">
          <span className="w-1.5 h-4 rounded-b-sm bg-track-slate" />
          <span className="w-1.5 h-4 rounded-b-sm bg-track-slate" />
        </div>
        {/* the caption sits on carbon, never on the sky — glow is not legibility */}
        <p className="mx-auto mt-1 w-fit rounded bg-track-carbon px-3 py-1 font-black text-[13px] tracking-[0.3em]"
          style={{ color: go ? '#7cf0b8' : '#ffffff' }}>
          {go ? 'GO GO GO' : 'GRID'}
        </p>
      </div>
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
    <div className="text-center py-4">
      <div className="flex items-center justify-center gap-3 mb-1">
        <span aria-hidden className="w-8 h-5 rounded-[3px]" style={{ backgroundImage: 'repeating-conic-gradient(#12151c 0 25%,#f4f6fa 0 50%)', backgroundSize: '8px 8px' }} />
        <h2 className="font-black text-[22px] tracking-[0.14em] text-white">{won ? 'RACE WINNER' : `P${place} FINISH`}</h2>
        <span aria-hidden className="w-8 h-5 rounded-[3px]" style={{ backgroundImage: 'repeating-conic-gradient(#12151c 0 25%,#f4f6fa 0 50%)', backgroundSize: '8px 8px' }} />
      </div>
      <p className="text-white/60 text-sm mb-6">{won ? 'You took the chequered flag.' : 'Sharpen up and go again.'}</p>

      <Podium ranked={ranked} />

      {ranked.length > 3 && (
        <div className="mt-3 max-w-sm mx-auto rounded-lg bg-track-carbon ring-1 ring-white/10 divide-y divide-white/8">
          {ranked.slice(3).map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${c.id === PLAYER_ID ? 'text-white font-bold' : 'text-white/75'}`}>
              <span className="font-black text-[11px] tabular-nums text-white/55 w-5 text-left">P{i + 4}</span>
              <span aria-hidden className="w-[3px] h-4 rounded-[1px]" style={{ background: c.color }} />
              <span className="flex-1 text-left">{c.name}</span>
              <span className="tabular-nums text-white/60 text-xs">{Math.round(trackFraction(c.distance) * 100)}% DISTANCE</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-3 mt-6 mb-2">
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-track-carbon ring-1 ring-white/10 text-neon-amber font-bold"><Coin width={18} height={18} /> +{rewards.coins}</span>
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-track-carbon ring-1 ring-white/10 font-bold" style={{ color: '#9dc2ff' }}><Bolt width={18} height={18} /> +{rewards.xp} XP</span>
      </div>
      {rewards.best && <div className="inline-block font-bold text-[10px] tracking-[0.16em] px-2.5 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2">NEW BEST</div>}
      <div className="text-xs text-white/50 mb-6">Level {level}</div>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onAgain} className="flex items-center gap-2 font-black text-[12px] tracking-[0.16em] px-5 py-3 rounded-lg"
          style={{ background: ACCENT, color: '#06122b' }}>
          <Replay width={16} height={16} /> RACE AGAIN
        </button>
        <button onClick={onPick} className="font-black text-[12px] tracking-[0.16em] px-5 py-3 rounded-lg bg-track-slate ring-1 ring-white/15 text-white hover:bg-track-asphalt transition">NEW SET</button>
        <button onClick={onHome} className="font-black text-[12px] tracking-[0.16em] px-5 py-3 rounded-lg bg-track-carbon ring-1 ring-white/10 text-white/85 hover:bg-track-slate transition">ARCADE</button>
      </div>
    </div>
  )
}

/** 1-2-3 rostrum: P2 left, P1 centre and tallest, P3 right. */
function Podium({ ranked }: { ranked: Car[] }) {
  // Rostrum metals: the top face of each step is lit gold / silver / bronze.
  const steps: { car: Car | undefined; place: number; h: number; metal: string }[] = [
    { car: ranked[1], place: 2, h: 62, metal: '#cfd6e2' },
    { car: ranked[0], place: 1, h: 92, metal: '#ffd76a' },
    { car: ranked[2], place: 3, h: 44, metal: '#d09257' },
  ]
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-3 max-w-sm mx-auto">
      {steps.map(({ car, place, h, metal }) => {
        if (!car) return null
        const isP = car.id === PLAYER_ID
        return (
          <div key={car.id} className="flex-1 flex flex-col items-center">
            <Helmet color={car.color} />
            <span className={`mt-1.5 font-bold text-[11px] tracking-[0.1em] truncate max-w-full ${isP ? 'text-white' : 'text-white/80'}`}>{car.name}</span>
            <div className="w-full rounded-t-md mt-1.5 grid place-items-center"
              style={{
                height: h,
                background: 'linear-gradient(180deg,#2a3244,#161a23)',
                boxShadow: `inset 0 4px 0 ${metal}${isP ? `, inset 0 0 0 2px ${ACCENT}` : ''}`,
              }}>
              <span className="font-black text-[26px] leading-none text-white/85 tabular-nums">{place}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Helmet({ color }: { color: string }) {
  return (
    <svg width="36" height="34" viewBox="0 0 36 34" aria-hidden>
      <path d="M18 3 C27 3 32 10 32 19 L32 24 Q32 29 26 29 L12 29 Q5 29 4.5 22 L4 19 C4 10 9 3 18 3 Z"
        fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7 8 Q18 2 29 9 L27.5 12.5 Q18 6.5 8.5 12 Z" fill="#f4f6fa" opacity="0.85" />
      <path d="M12 15 Q21 12 32 15.5 L32 22 Q21 24 12 21 Z" fill="#12151c" />
      <path d="M14 16.5 Q22 14.5 31 17 L31 18.5 Q22 16.5 14 18 Z" fill="#7fd0ff" opacity="0.55" />
      <path d="M6 24 Q18 27 32 24 L32 25 Q18 28.5 6 25.5 Z" fill="#000" opacity="0.28" />
    </svg>
  )
}
