// Last Standing — timed-question elimination around the 3D table. The page
// owns everything effectful: the real countdown (interval, cleaned up on every
// state change), AI turns resolving on a short delay, the human's banish pick,
// and the single finishGame write at game over. All rules live in
// lib/laststanding.ts; questions come from the curriculum model via the same
// course → topics picker as the Card Game.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSE_LIST, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { loadCourse } from '../lib/content'
import { usePlayer, resolveCourseId, levelFromXp } from '../lib/player'
import {
  SEAT_COUNT, createLobby, isAlive, lobbySeats, timeForTurn, applyAnswer, banish,
  aiRateFor, aiAnswerChance, aiSolves, aiBanishTarget, scoreForPlacement,
  type LsState,
} from '../lib/laststanding'
import { useAuth } from '../lib/auth'
import { seatNameFor } from '../lib/username'
import { useUsernames } from '../lib/useUsernames'
import { createRoom, subscribeMyRooms, roomsAvailable, type LsRoom } from '../lib/lsroom'
import LastStandingTable3D from '../components/LastStandingTable3D'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, taggedPool, type AnsweredItem, type TaggedQuestion } from '../lib/summary'
import { isReducedMotion } from '../lib/motion'
import { ArrowLeft, Volume, VolumeMute, Coin, Bolt, Replay, Star, Crown } from '../icons'
import { sfxPick, sfxDeny, sfxWin, setMuted, isMuted } from '../lib/sound'

const ACCENT = '#ff4d8d' // neon pink — the Last Standing cabinet's accent
// Seat 1 is the "friend" seat — an AI placeholder until real online friends (v2).
const AI_NAMES = ['FRIEND', 'NOVA', 'VEGA', 'ORION'] as const
const MAX_TOPICS = 6
const AI_THINK_MS = 1600 // an AI "reads" the question this long before answering
const BANISH_MS = 2200 // the beat before an AI winner's pick lands

const subKey = (unitId: string, subId: string) => `${unitId}/${subId}`

/** Combined reduced-motion preference: OS setting OR the in-app Settings toggle. */
function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// Weight selected topics by question count and snap to a band — the same
// aggregate the Card Game and Racer use to size the AI field.
function aggregateDifficulty(subs: Subunit[]): Difficulty {
  const rank: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 }
  let total = 0
  let weight = 0
  for (const s of subs) { total += rank[s.difficulty] * s.questions.length; weight += s.questions.length }
  if (weight === 0) return 'medium'
  const avg = total / weight
  return avg <= 0.5 ? 'easy' : avg >= 1.5 ? 'hard' : 'medium'
}

type Screen = 'course' | 'build' | 'play'

interface GameResult {
  placement: number
  score: number
  rewards: { xp: number; coins: number; best: boolean }
}

export default function LastStanding() {
  const navigate = useNavigate()
  const { player, finishGame, recordAnswer } = usePlayer()
  const preferredCourseId = resolveCourseId(player.preferredCourseId)

  const [screen, setScreen] = useState<Screen>('course')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [muted, setMutedState] = useState(isMuted())

  // Online tables live entirely in LastStandingOnline; this page only opens one
  // and lists the ones already waiting for you.
  const { user, emailVerified } = useAuth()
  const [myRooms, setMyRooms] = useState<LsRoom[]>([])
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomError, setRoomError] = useState('')
  const canPlayOnline = roomsAvailable() && user !== null && emailVerified
  // My own handle, so the seat carries it instead of my email address.
  const myHandles = useUsernames(user ? [user.uid] : [])

  const [game, setGame] = useState<LsState | null>(null)
  const [question, setQuestion] = useState<TaggedQuestion | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [result, setResult] = useState<GameResult | null>(null)
  const poolRef = useRef<TaggedQuestion[]>([])
  // Session-scoped answers, tagged by subtopic — feeds the end-of-game summary.
  const answersRef = useRef<AnsweredItem[]>([])
  const difficultyRef = useRef<Difficulty>('medium')
  const finishedRef = useRef(false)

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    setCourse(null)
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [courseId])

  useEffect(() => {
    if (!canPlayOnline || !user) { setMyRooms([]); return }
    return subscribeMyRooms(user.uid, setMyRooms, () => setMyRooms([]))
  }, [canPlayOnline, user])

  /** Opens an online table on the single selected topic and jumps into it. */
  async function hostTable() {
    if (!user || selectedSubs.length !== 1) return
    const sub = selectedSubs[0]
    const unit = course?.units.find((u) => u.subunits.some((s) => s.id === sub.id))
    if (!unit || !courseId) return
    setRoomBusy(true)
    setRoomError('')
    try {
      const id = await createRoom(
        { uid: user.uid, name: seatNameFor(myHandles[user.uid], user.email) },
        { courseId, unitId: unit.id, subunitId: sub.id, difficulty: sub.difficulty },
        Math.floor(Math.random() * 0x7fffffff),
      )
      navigate(`/laststanding/room/${id}`)
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Could not open a table.')
    } finally {
      setRoomBusy(false)
    }
  }

  const selectedSubs: Subunit[] = useMemo(() => course
    ? course.units.flatMap((u) => u.subunits.filter((s) => selected.has(subKey(u.id, s.id))))
    : [], [course, selected])
  const questionCount = selectedSubs.reduce((n, s) => n + s.questions.length, 0)
  const canStart = selectedSubs.length > 0 && questionCount > 0

  function toggleSub(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else { if (next.size >= MAX_TOPICS) return prev; next.add(key) }
      return next
    })
  }

  function begin() {
    poolRef.current = taggedPool(selectedSubs)
    answersRef.current = []
    difficultyRef.current = aggregateDifficulty(selectedSubs)
    finishedRef.current = false
    setResult(null)
    setQuestion(null)
    setSecondsLeft(null)
    setLog('Round 1 — you lead off.')
    setGame(createLobby(AI_NAMES))
    setScreen('play')
  }

  function start() {
    if (!canStart) return
    begin()
  }

  // Game over: the champion is decided, or the human has been banished (the
  // game among AIs would continue, but our seat at the table is gone).
  const gameOver = game !== null
    && (game.phase.kind === 'champion' || !game.seats[0].inLobby)

  // Human placement: champion = 1; banished = one worse than everyone still in.
  function placementOf(g: LsState): number {
    if (g.phase.kind === 'champion' && g.phase.champion === 0) return 1
    return lobbySeats(g).length + (g.seats[0].inLobby ? 0 : 1)
  }

  const humanTurn = game !== null && !gameOver
    && game.phase.kind === 'turn' && game.turn === 0

  // ---- the turn engine: one effect keyed on the game state -----------------
  // Each new state starts fresh timers; cleanup kills them, so a resolved turn
  // can never double-fire a timeout or an AI answer.
  useEffect(() => {
    if (!game || gameOver || screen !== 'play') return

    if (game.phase.kind === 'turn') {
      const actor = game.seats[game.turn]
      const allotted = timeForTurn(actor.turnsTaken)
      setSecondsLeft(allotted)

      if (actor.kind === 'human') {
        // Draw the question at the turn boundary — the ONLY rng for content.
        const pool = poolRef.current
        setQuestion(pool[Math.floor(Math.random() * pool.length)] ?? null)
        let remaining = allotted
        const tick = window.setInterval(() => {
          remaining -= 1
          setSecondsLeft(remaining)
          if (remaining <= 0) {
            window.clearInterval(tick)
            sfxDeny()
            const next = applyAnswer(game, false)
            setLog(describeOutcome(game, next, false, 'Time ran out'))
            setQuestion(null)
            setGame(next)
          }
        }, 1000)
        return () => window.clearInterval(tick)
      }

      // AI turn: think briefly, then roll accuracy against the shrinking clock.
      setQuestion(null)
      const t = window.setTimeout(() => {
        const chance = aiAnswerChance(aiRateFor(actor.seat - 1, difficultyRef.current), allotted)
        const ok = aiSolves(Math.random, chance)
        const next = applyAnswer(game, ok)
        setLog(describeOutcome(game, next, ok, ok ? `${actor.name} answered correctly` : `${actor.name} missed`))
        setGame(next)
      }, AI_THINK_MS)
      return () => window.clearTimeout(t)
    }

    // Banish phase — an AI winner auto-picks the biggest threat after a beat.
    // (Champion never reaches here: gameOver already bailed above.)
    if (game.phase.kind !== 'banish') return undefined
    setSecondsLeft(null)
    setQuestion(null)
    const winner = game.phase.winner
    if (game.seats[winner].kind === 'ai') {
      const t = window.setTimeout(() => {
        const target = aiBanishTarget(game, winner)
        if (target < 0) return
        setLog(`${game.seats[winner].name} banished ${target === 0 ? 'YOU' : game.seats[target].name} from the lobby.`)
        setGame(banish(game, target))
      }, BANISH_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [game, gameOver, screen])

  // The single reward write, exactly once per game.
  useEffect(() => {
    if (!game || !gameOver || finishedRef.current) return
    finishedRef.current = true
    const placement = placementOf(game)
    const score = scoreForPlacement(placement, SEAT_COUNT)
    if (placement === 1) sfxWin()
    setResult({ placement, score, rewards: finishGame('laststanding', score) })
  }, [game, gameOver, finishGame])

  function answer(correct: boolean) {
    if (!game || !humanTurn) return
    recordAnswer(correct) // the sanctioned answer path — timeouts never count
    if (question) answersRef.current.push({ subunitId: question.subunitId, subunitName: question.subunitName, correct })
    if (correct) sfxPick(); else sfxDeny()
    const next = applyAnswer(game, correct)
    setLog(describeOutcome(game, next, correct, correct ? 'Correct' : 'Wrong'))
    setQuestion(null)
    setGame(next)
  }

  function pickBanish(target: number) {
    if (!game || game.phase.kind !== 'banish' || game.phase.winner !== 0) return
    setLog(`You banished ${game.seats[target].name} from the lobby.`)
    setGame(banish(game, target))
  }

  function goBack() {
    if (screen === 'course') { navigate('/'); return }
    if (screen === 'build') { setScreen('course'); return }
    setGame(null)
    setScreen('build') // leave a game in progress back to setup
  }

  const humanBanishing = game !== null && !gameOver
    && game.phase.kind === 'banish' && game.phase.winner === 0

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={goBack} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="flex items-center gap-2 font-sans font-bold text-sm tracking-[0.14em]" style={{ color: '#ff9dbd' }}><Crown width={18} height={18} /> LAST STANDING</div>
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>

        {screen === 'course' && myRooms.length > 0 && (
          <div className="mb-8">
            <Section title="YOUR TABLES">
              <ul className="grid gap-2">
                {myRooms.map((r) => {
                  const seated = r.members.includes(user?.uid ?? '')
                  return (
                    <li key={r.id} className="flex items-center justify-between rounded-lg border px-4 py-3"
                      style={{ borderColor: seated ? 'rgba(255,255,255,0.1)' : `${ACCENT}66` }}>
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">
                          {seated ? 'Your table' : 'You’re invited'}
                        </span>
                        <span className="block text-xs text-white/55">
                          {r.members.length} seated · {r.status === 'lobby' ? 'waiting to start' : r.status === 'active' ? 'in play' : 'finished'}
                        </span>
                      </span>
                      <button onClick={() => navigate(`/laststanding/room/${r.id}`)}
                        className="shrink-0 font-sans text-xs font-bold px-3 py-1.5 rounded text-white"
                        style={{ background: ACCENT }}>
                        {seated ? 'Open' : 'View invite'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Section>
          </div>
        )}

        {screen === 'course' && (
          <Section title="CHOOSE A COURSE">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id} onClick={() => { setCourseId(c.id); setSelected(new Set()); setScreen('build') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className={`text-left rounded-xl border bg-white/[0.03] p-4 transition ${preferred ? 'border-neon-pink/70' : 'border-white/10 hover:border-neon-pink/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{c.name}</span>
                      {preferred && <span className="shrink-0 font-sans text-[10px] font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${ACCENT}33`, color: '#ff9dbd' }}>YOUR LEVEL</span>}
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
              Load up to {MAX_TOPICS} topics. Miss a question — or run out the shrinking clock — and you lose a life.
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
                            className={`flex items-center gap-3 text-left rounded-lg border p-3 transition ${disabled ? 'opacity-45 cursor-default border-white/10' : 'hover:border-neon-pink/50 border-white/10'}`}
                            style={checked ? { borderColor: ACCENT, background: `${ACCENT}1f` } : undefined}>
                            <span aria-hidden className="grid place-items-center w-5 h-5 rounded border shrink-0"
                              style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.4)', background: checked ? ACCENT : 'transparent' }}>
                              {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#150c30" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
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
                  className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-white disabled:opacity-40 transition"
                  style={{ background: ACCENT, boxShadow: canStart ? `0 6px 20px -6px ${ACCENT}` : 'none' }}>
                  Take your seat
                </button>
                {canPlayOnline && (
                  <button onClick={() => void hostTable()} disabled={selectedSubs.length !== 1 || roomBusy}
                    className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-white/90 border border-white/20 bg-white/5 enabled:hover:bg-white/10 disabled:opacity-40 transition">
                    {roomBusy ? 'Opening a table…' : 'Play with friends'}
                  </button>
                )}
              </div>
              {!canStart && <span className="text-xs text-white/60">Select at least one topic to start.</span>}
              {canStart && canPlayOnline && selectedSubs.length !== 1 && (
                <span className="text-xs text-white/60">Playing with friends uses a single shared topic — select exactly one.</span>
              )}
              {roomError && <span role="alert" className="text-xs" style={{ color: '#ff9dbd' }}>{roomError}</span>}
            </div>
          </Section>
        )}

        {screen === 'play' && game && !(gameOver && result) && (
          <div>
            <LastStandingTable3D state={game} accent={ACCENT} reduced={prefersReducedMotion()} secondsLeft={secondsLeft} />

            {/* round + timer strip — text carries the state, never color alone */}
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-4 py-2.5">
              <span className="font-sans text-xs font-bold tracking-[0.14em] text-white/80">ROUND {game.round}</span>
              {game.phase.kind === 'turn' && secondsLeft !== null && (
                <span role="timer" aria-label={`${secondsLeft} seconds left`} className="font-sans text-sm font-bold tabular-nums"
                  style={{ color: secondsLeft <= 5 ? '#ff9dbd' : 'rgba(255,255,255,0.9)' }}>
                  {game.turn === 0 ? 'YOUR CLOCK' : `${game.seats[game.turn].name}'S CLOCK`} · {secondsLeft}s
                </span>
              )}
            </div>

            <div className="mt-4">
              {humanTurn && question && (
                <QuestionPanel q={question.q} color={ACCENT} onSubmit={answer} label="ANSWER BEFORE THE CLOCK RUNS OUT" surface="plain" />
              )}
              {humanTurn && !question && (
                <Panel><p className="text-center text-sm text-white/70">No questions in your topics — pick different topics.</p></Panel>
              )}
              {!humanTurn && game.phase.kind === 'turn' && (
                <p className="text-center text-sm text-white/60 py-3">
                  {isAlive(game.seats[0]) ? `${game.seats[game.turn].name} is answering…` : `You're out this round — ${game.seats[game.turn].name} is answering…`}
                </p>
              )}
              {humanBanishing && (
                <Panel>
                  <p className="text-center font-sans font-bold text-sm tracking-wide mb-1" style={{ color: '#ff9dbd' }}>YOU WIN THE ROUND</p>
                  <p className="text-center text-sm text-white/70 mb-4">Banish one player from the lobby — for good.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {lobbySeats(game).filter((s) => s.seat !== 0).map((s) => (
                      <button key={s.seat} onClick={() => pickBanish(s.seat)}
                        className="font-sans font-bold text-sm px-4 py-3 rounded-lg text-white border border-white/15 bg-white/5 hover:bg-white/10 transition"
                        style={{ boxShadow: `inset 3px 0 0 ${ACCENT}` }}>
                        Banish {s.name}
                      </button>
                    ))}
                  </div>
                </Panel>
              )}
              {game.phase.kind === 'banish' && game.phase.winner !== 0 && !gameOver && (
                <p className="text-center text-sm text-white/60 py-3">{game.seats[game.phase.winner].name} wins the round and is choosing who to banish…</p>
              )}
            </div>

            {/* screen-reader narration: turn outcomes + low-clock warnings */}
            <p className="sr-only" aria-live="polite">
              {log}{secondsLeft !== null && (secondsLeft === 10 || secondsLeft === 5) ? ` ${secondsLeft} seconds left.` : ''}
            </p>
            <div className="mt-3 text-center text-[12px] text-white/60" aria-hidden>{log}</div>
          </div>
        )}

        {screen === 'play' && game && gameOver && result && (
          <Results game={game} result={result} answers={answersRef.current} level={levelFromXp(player.xp).level}
            onAgain={begin} onPick={() => { setGame(null); setScreen('build') }} onHome={() => navigate('/')} />
        )}
      </div>
    </div>
  )
}

// One line of narration for a resolved turn — who did what, and what it cost.
function describeOutcome(before: LsState, after: LsState, correct: boolean, lead: string): string {
  const actor = before.seats[before.turn]
  const who = actor.seat === 0 ? 'You' : actor.name
  let line = `${lead}.`
  if (!correct) {
    const livesAfter = after.seats[actor.seat].lives
    line += livesAfter <= 0
      ? ` ${who} ${actor.seat === 0 ? 'are' : 'is'} eliminated this round.`
      : ` ${who} ${actor.seat === 0 ? 'lose' : 'loses'} a life (${livesAfter} left).`
  }
  if (after.phase.kind === 'banish') {
    const w = after.seats[after.phase.winner]
    line += ` ${w.seat === 0 ? 'You are' : `${w.name} is`} the last standing.`
  }
  return line
}

function Results({ game, result, answers, level, onAgain, onPick, onHome }: {
  game: LsState; result: GameResult; answers: readonly AnsweredItem[]; level: number
  onAgain: () => void; onPick: () => void; onHome: () => void
}) {
  const won = result.placement === 1
  const ord = ['', 'CHAMPION', '2ND', '3RD', '4TH', '5TH'][result.placement] ?? `${result.placement}TH`
  return (
    <div className="text-center py-6">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: won ? '#3dffa2' : '#ff9dbd' }}>
        {won ? 'Last one standing!' : `${ord} place`}
      </div>
      <p className="text-white/60 text-sm mb-6">
        {won
          ? `You banished all ${SEAT_COUNT - 1} rivals and took the table.`
          : `Banished in round ${game.round} — you outlasted ${SEAT_COUNT - result.placement} player${SEAT_COUNT - result.placement === 1 ? '' : 's'}.`}
      </p>

      <div className="flex justify-center gap-3 mb-2">
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold"><Coin width={18} height={18} /> +{result.rewards.coins}</span>
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#ff9dbd' }}><Bolt width={18} height={18} /> +{result.rewards.xp} XP</span>
      </div>
      {result.rewards.best && <div className="inline-flex items-center gap-1 font-sans font-bold text-[11px] tracking-wide px-2.5 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2"><Star width={12} height={12} /> NEW BEST</div>}
      <div className="text-xs text-white/50 mb-6">Level {level}</div>

      <div className="text-left max-w-sm mx-auto mb-6">
        <SessionSummary summary={summarize(answers)} color={ACCENT} />
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onAgain} className="flex items-center gap-2 font-sans font-bold text-sm px-5 py-3 rounded-lg text-white" style={{ background: ACCENT }}>
          <Replay width={16} height={16} /> Play again
        </button>
        <button onClick={onPick} className="font-sans font-semibold text-sm px-5 py-3 rounded-lg bg-white/5 border border-white/15 text-white/85 hover:bg-white/10 transition">New topics</button>
        <button onClick={onHome} className="font-sans font-semibold text-sm px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Arcade</button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-sans font-bold text-sm tracking-[0.18em] mb-5 text-center" style={{ color: '#ff9dbd' }}>{title}</h2>{children}</div>
}
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">{children}</div>
}
function DiffBadge({ d }: { d: Difficulty }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[10px] font-sans font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
