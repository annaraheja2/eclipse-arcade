import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSES, COURSE_LIST, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { loadCourse } from '../lib/content'
import {
  RACERS, START_SQUARE, LAST_SQUARE, rollDie, resolveMove, nextRacer,
  placements, finalScore, POINTS_PER_CORRECT, PLACEMENT_BONUS,
} from '../lib/ascend'
import AscendBoard3D, { type BoardMove } from '../components/AscendBoard3D'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, taggedPool, type AnsweredItem, type TaggedQuestion } from '../lib/summary'
import { useAuth } from '../lib/auth'
import { createGameRoom, gameRoomsAvailable } from '../lib/gameroom'
import { createAscendState, ascendStateData } from '../lib/ascendRoom'
import { useUsernames } from '../lib/useUsernames'
import { seatName } from '../lib/username'
import { usePlayer, resolveCourseId } from '../lib/player'
import { isReducedMotion } from '../lib/motion'
import { SEAT_TINTS } from '../components/Character3D'
import { ArrowLeft, Ladder } from '../icons'

const ACCENT = '#3dffa2'
const ACCENT_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': ACCENT, '--edge': `color-mix(in srgb, ${ACCENT} 50%, #000)`, '--glow': `${ACCENT}88`,
}

const MAX_TOPICS = 6
const subKey = (unitId: string, subId: string) => `${unitId}/${subId}`

// Safety net only: if a selection somehow yields zero questions, the race draws
// from the bundled first course rather than crashing mid-climb.
const FALLBACK_POOL: readonly TaggedQuestion[] =
  COURSES[0].units.flatMap((u) => taggedPool(u.subunits))

const draw = (pool: readonly TaggedQuestion[]): TaggedQuestion => pool[Math.floor(Math.random() * pool.length)]

/** Combined reduced-motion preference: OS setting OR the in-app toggle. */
function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// The turn loop: your turn opens on 'question' (solve to unlock the roll);
// a wrong answer shows 'wrong' briefly and passes. AI turns sit in 'ai-think'
// then auto-roll. Both funnel through 'moving' (the board animates) and back.
type Phase = 'question' | 'wrong' | 'moving' | 'ai-think' | 'over'

// Pre-race chrome (mirrors CardGame): pick a course, then topics, then climb.
type Screen = 'course' | 'build' | 'play'

export default function Ascend() {
  const navigate = useNavigate()
  const { player, finishGame, recordAnswer } = usePlayer()
  const { user, emailVerified } = useAuth()
  const preferredCourseId = resolveCourseId(player.preferredCourseId)
  const reduced = prefersReducedMotion()

  const [screen, setScreen] = useState<Screen>('course')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pool, setPool] = useState<readonly TaggedQuestion[]>(FALLBACK_POOL)
  // Session-scoped, tagged by subtopic — feeds the end-of-race summary.
  const [answers, setAnswers] = useState<AnsweredItem[]>([])

  const [positions, setPositions] = useState<number[]>(() => RACERS.map(() => START_SQUARE))
  const [turn, setTurn] = useState(0)
  const [phase, setPhase] = useState<Phase>('question')
  const [q, setQ] = useState<TaggedQuestion>(() => draw(FALLBACK_POOL))
  const [move, setMove] = useState<BoardMove | null>(null)
  const [lastRoll, setLastRoll] = useState<{ racer: number; value: number } | null>(null)
  const [correct, setCorrect] = useState(0)
  const [winner, setWinner] = useState<number | null>(null)
  const [reward, setReward] = useState<{ score: number; place: number; xp: number; coins: number; best: boolean } | null>(null)
  const seqRef = useRef(0)
  const correctRef = useRef(0)

  // Load the picked course (loadCourse always resolves — bundled fallback).
  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    setCourse(null)
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [courseId])

  const selectedSubs: Subunit[] = useMemo(() => course
    ? course.units.flatMap((u) => u.subunits.filter((s) => selected.has(subKey(u.id, s.id))))
    : [], [course, selected])
  const questionCount = selectedSubs.reduce((n, s) => n + s.questions.length, 0)
  const canStart = selectedSubs.length > 0 && questionCount > 0
  // A table runs on one topic, so hosting needs exactly one pick and a signed-in
  // player to be the host.
  const canHost = !!user && emailVerified && selectedSubs.length === 1 && questionCount > 0
  const [hosting, setHosting] = useState(false)
  const [hostError, setHostError] = useState('')
  const myName = useUsernames(user ? [user.uid] : [])

  function toggleSub(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else { if (next.size >= MAX_TOPICS) return prev; next.add(key) }
      return next
    })
  }

  // Reset every piece of race state and open on your first question.
  function startRace(nextPool: readonly TaggedQuestion[]) {
    setPool(nextPool)
    setAnswers([])
    setPositions(RACERS.map(() => START_SQUARE))
    setTurn(0)
    setQ(draw(nextPool))
    setMove(null)
    setLastRoll(null)
    setCorrect(0)
    correctRef.current = 0
    setWinner(null)
    setReward(null)
    setPhase('question')
  }

  function start() {
    if (!canStart) return
    const qs = taggedPool(selectedSubs)
    startRace(qs.length > 0 ? qs : FALLBACK_POOL)
    setScreen('play')
  }

  /**
   * Opens a table for friends. An online table runs on ONE topic — the room
   * document carries a single subunit, the same as a Last Standing table — so
   * hosting asks for exactly one pick rather than the solo game's set of six.
   */
  async function host() {
    if (!canHost || !course || !user) return
    // The selection key already carries the unit. Searching for a unit by
    // subunit id alone would be wrong: ids are unique within a unit, not across
    // a course — 'applications' exists under two different Algebra 2 units, so
    // a lookup could seat the table on the wrong topic entirely.
    const [unitId, subId] = [...selected][0].split('/')
    const unit = course.units.find((u) => u.id === unitId)
    const sub = unit?.subunits.find((s) => s.id === subId)
    if (!unit || !sub) return
    setHosting(true)
    setHostError('')
    try {
      const roomId = await createGameRoom(
        'ascend',
        { uid: user.uid, name: seatName(myName[user.uid], user.email) },
        { courseId: course.id, unitId: unit.id, subunitId: sub.id, difficulty: sub.difficulty },
        Math.floor(Math.random() * 1e9),
        (seats) => ascendStateData(createAscendState(seats)),
      )
      navigate(`/ascend/room/${roomId}`)
    } catch (err) {
      console.error('[eclipse-arcade] could not open a table:', err)
      setHostError('Could not open a table — online play may not be switched on yet.')
      setHosting(false)
    }
  }

  function goBack() {
    if (screen === 'course') { navigate('/'); return }
    if (screen === 'build') { setScreen('course'); return }
    setScreen('build') // leave a race in progress back to setup
  }

  function startMove(racer: number) {
    const value = rollDie(Math.random)
    const from = positions[racer]
    const { path, chute } = resolveMove(from, value)
    setLastRoll({ racer, value })
    setMove({ seq: ++seqRef.current, racer, from, path, chute })
    setPhase('moving')
  }

  function onAnswer(ok: boolean) {
    if (phase !== 'question') return
    recordAnswer(ok)
    setAnswers((a) => [...a, { subunitId: q.subunitId, subunitName: q.subunitName, correct: ok }])
    if (ok) {
      setCorrect((c) => c + 1)
      correctRef.current += 1
      startMove(0)
    } else {
      setPhase('wrong')
    }
  }

  // A wrong answer lingers just long enough to read, then the turn passes.
  useEffect(() => {
    if (phase !== 'wrong') return
    const id = setTimeout(() => { setTurn(1); setPhase('ai-think') }, 1300)
    return () => clearTimeout(id)
  }, [phase])

  // AI turns: a short beat, then they just roll — your math is your edge.
  useEffect(() => {
    if (phase !== 'ai-think') return
    const id = setTimeout(() => startMove(turn), reduced ? 300 : 1000)
    return () => clearTimeout(id)
    // Keyed on phase+turn (not startMove) so it fires exactly once per AI turn.
  }, [phase, turn]) // eslint-disable-line react-hooks/exhaustive-deps

  function onMoveDone(seq: number) {
    if (seq !== seqRef.current || !move) return
    const { racer } = move
    const landed = move.chute ? move.chute.to : move.path[move.path.length - 1]
    const next = positions.map((p, i) => (i === racer ? landed : p))
    setPositions(next)
    setMove(null)
    if (landed === LAST_SQUARE) {
      const place = placements(next, racer)[0]
      const score = finalScore(correctRef.current, place)
      const r = finishGame('ascend', score)
      setWinner(racer)
      setReward({ score, place, ...r })
      setPhase('over')
      return
    }
    const who = nextRacer(racer, RACERS.length)
    setTurn(who)
    if (who === 0) { setQ(draw(pool)); setPhase('question') } else { setPhase('ai-think') }
  }

  const statusText =
    phase === 'question' ? 'SOLVE TO ROLL'
      : phase === 'wrong' ? 'WRONG — TURN PASSES'
        : phase === 'over' ? (winner === 0 ? 'YOU REACHED THE SUMMIT' : `${RACERS[winner ?? 1].name} WINS`)
          : phase === 'moving' && lastRoll ? `${RACERS[lastRoll.racer].name} ROLLED ${lastRoll.value}`
            : `${RACERS[turn].name} IS ROLLING`

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-5">
          <button aria-label="Back" onClick={goBack}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="flex items-center gap-2 font-pixel text-[12px]" style={{ color: ACCENT }}>
            <Ladder width={16} height={16} aria-hidden />ASCEND
          </div>
          <div aria-hidden className="w-10 h-10" />
        </div>

        {screen === 'course' && (
          <Section title="CHOOSE A COURSE">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id} onClick={() => { setCourseId(c.id); setSelected(new Set()); setScreen('build') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className={`text-left rounded-xl border bg-white/[0.03] p-4 transition ${preferred ? 'border-neon-green/70' : 'border-white/10 hover:border-neon-green/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{c.name}</span>
                      {preferred && <span className="shrink-0 font-sans text-[10px] font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${ACCENT}33`, color: ACCENT }}>YOUR LEVEL</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {screen === 'build' && !course && (
          <p className="text-center text-white/70 font-sans text-sm py-16">Loading course…</p>
        )}

        {screen === 'build' && course && (
          <Section title="PICK YOUR TOPICS">
            <p className="text-center text-sm text-white/60 mb-5">
              Load up to {MAX_TOPICS} topics. Each correct answer earns you a roll toward the summit.
            </p>
            <div className="flex items-center justify-between mb-4 rounded-lg bg-white/[0.03] border border-white/10 px-4 py-2.5">
              <span className="font-sans text-xs font-semibold tracking-wide text-white/80">{selected.size}/{MAX_TOPICS} topics · {questionCount} questions</span>
              <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
                className="font-sans text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">Clear</button>
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
                        const noQ = s.questions.length === 0
                        const blocked = !checked && selected.size >= MAX_TOPICS
                        const disabled = noQ || blocked
                        return (
                          <button key={s.id} role="checkbox" aria-checked={checked} aria-disabled={disabled}
                            onClick={() => { if (!disabled) toggleSub(key) }}
                            className={`flex items-center gap-3 text-left rounded-lg border p-3 transition ${disabled ? 'opacity-45 cursor-default border-white/10' : 'hover:border-neon-green/50 border-white/10'}`}
                            style={checked ? { borderColor: ACCENT, background: `${ACCENT}1f` } : undefined}>
                            <span aria-hidden className="grid place-items-center w-5 h-5 rounded border shrink-0"
                              style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.4)', background: checked ? ACCENT : 'transparent' }}>
                              {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a2b18" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-semibold truncate">{s.name}</span>
                                <DiffBadge d={s.difficulty} />
                              </span>
                              <span className="block text-xs text-white/55 mt-0.5">{noQ ? 'No questions yet' : `${s.questions.length} questions`}</span>
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
              <div className="flex flex-wrap justify-center gap-3">
                <button onClick={start} disabled={!canStart}
                  className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-[#0a0620] disabled:opacity-40 transition"
                  style={{ background: ACCENT, boxShadow: canStart ? `0 6px 20px -6px ${ACCENT}` : 'none' }}>
                  Start the climb
                </button>
                {gameRoomsAvailable() && (
                  <button onClick={host} disabled={!canHost || hosting}
                    className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-white/90 border border-white/20 bg-white/5 enabled:hover:bg-white/10 disabled:opacity-40 transition">
                    {hosting ? 'Opening a table…' : 'Play with friends'}
                  </button>
                )}
              </div>
              {!canStart && <span className="text-xs text-white/60">Select at least one topic to start.</span>}
              {canStart && !canHost && (
                <span className="text-xs text-white/60">Pick a single topic to play with friends.</span>
              )}
              {hostError && <span role="alert" className="text-xs text-[#ff9dbd]">{hostError}</span>}
            </div>
          </Section>
        )}

        {screen === 'play' && (<>
        {/* racer standings — square 0 is the start pad, 100 the summit */}
        <div className="flex justify-center gap-3 mb-4">
          {RACERS.map((r) => (
            <div key={r.seat}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-full border bg-white/[0.04] ${turn === r.seat && phase !== 'over' ? '' : 'border-white/10'}`}
              style={turn === r.seat && phase !== 'over' ? { borderColor: `${SEAT_TINTS[r.seat]}aa` } : undefined}>
              <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: SEAT_TINTS[r.seat] }} />
              <span className="text-xs font-semibold text-white/90">{r.name}</span>
              <span className="font-pixel text-[9px] text-white/80 tabular-nums">{positions[r.seat]}</span>
            </div>
          ))}
        </div>

        <AscendBoard3D positions={positions} activeRacer={phase === 'over' ? (winner ?? 0) : turn}
          move={move} onMoveDone={onMoveDone} reduced={reduced} />

        <div className="h-8 mt-3 text-center font-pixel text-[11px]" aria-live="polite"
          style={{ color: phase === 'wrong' ? '#ff9dbd' : ACCENT }}>
          {statusText}
        </div>

        {phase === 'question' && (
          <QuestionPanel q={q.q} color={ACCENT} onSubmit={onAnswer} label="SOLVE TO EARN YOUR ROLL" />
        )}
        {(phase === 'moving' || phase === 'ai-think') && (
          <p className="text-center text-sm text-white/65">
            {turn === 0 ? 'Climbing…' : `${RACERS[turn].name} is taking a turn…`}
          </p>
        )}

        {phase === 'over' && reward && (
          <div className="text-center py-8">
            <div className="font-pixel text-2xl mb-4" style={{ color: winner === 0 ? ACCENT : '#ff4d8d' }}>
              {winner === 0 ? 'VICTORY!' : 'RACE OVER'}
            </div>
            <p className="text-white/70 mb-1">
              You placed <span className="font-bold text-white">{ordinal(reward.place)}</span> with {correct} correct answer{correct === 1 ? '' : 's'}.
            </p>
            <p className="text-white/70 mb-5">
              Score <span className="font-bold tabular-nums" style={{ color: ACCENT }}>{reward.score.toLocaleString()}</span>
              {' '}({correct} × {POINTS_PER_CORRECT} + {PLACEMENT_BONUS[reward.place - 1] ?? 0} place bonus)
              {' '}· +{reward.xp} XP · +{reward.coins} coins{reward.best ? ' · NEW BEST' : ''}
            </p>
            <div className="text-left mb-6">
              <SessionSummary summary={summarize(answers)} color={ACCENT} />
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button onClick={() => startRace(pool)}
                className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={ACCENT_BTN}>
                PLAY AGAIN
              </button>
              <button onClick={() => setScreen('build')}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                NEW TOPICS
              </button>
              <button onClick={() => navigate('/')}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                ARCADE
              </button>
            </div>
          </div>
        )}
        </>)}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-pixel text-[12px] tracking-wide mb-6 text-center" style={{ color: ACCENT }}>{title}</h2>{children}</div>
}

function DiffBadge({ d }: { d: Difficulty }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[10px] font-sans font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}
