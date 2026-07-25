import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSES, type Question } from '../data/subjects'
import {
  RACERS, START_SQUARE, LAST_SQUARE, rollDie, resolveMove, nextRacer,
  placements, finalScore, POINTS_PER_CORRECT, PLACEMENT_BONUS,
} from '../lib/ascend'
import AscendBoard3D, { type BoardMove } from '../components/AscendBoard3D'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer } from '../lib/player'
import { isReducedMotion } from '../lib/motion'
import { SEAT_TINTS } from '../components/Character3D'
import { ArrowLeft, Ladder } from '../icons'

const ACCENT = '#3dffa2'
const ACCENT_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': ACCENT, '--edge': `color-mix(in srgb, ${ACCENT} 50%, #000)`, '--glow': `${ACCENT}88`,
}

// v1 content: reuse the bundled Algebra 1 "Solving Linear Equations" unit —
// no new authoring; real curriculum picking can come later.
const QUESTION_POOL: readonly Question[] =
  COURSES[0].units.find((u) => u.id === 'solving-linear-equations')?.subunits.flatMap((s) => s.questions)
  ?? COURSES[0].units.flatMap((u) => u.subunits.flatMap((s) => s.questions))

const randomQ = (): Question => QUESTION_POOL[Math.floor(Math.random() * QUESTION_POOL.length)]

/** Combined reduced-motion preference: OS setting OR the in-app toggle. */
function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// The turn loop: your turn opens on 'question' (solve to unlock the roll);
// a wrong answer shows 'wrong' briefly and passes. AI turns sit in 'ai-think'
// then auto-roll. Both funnel through 'moving' (the board animates) and back.
type Phase = 'question' | 'wrong' | 'moving' | 'ai-think' | 'over'

export default function Ascend() {
  const navigate = useNavigate()
  const { finishGame, recordAnswer } = usePlayer()
  const reduced = prefersReducedMotion()

  const [positions, setPositions] = useState<number[]>(() => RACERS.map(() => START_SQUARE))
  const [turn, setTurn] = useState(0)
  const [phase, setPhase] = useState<Phase>('question')
  const [q, setQ] = useState<Question>(randomQ)
  const [move, setMove] = useState<BoardMove | null>(null)
  const [lastRoll, setLastRoll] = useState<{ racer: number; value: number } | null>(null)
  const [correct, setCorrect] = useState(0)
  const [winner, setWinner] = useState<number | null>(null)
  const [reward, setReward] = useState<{ score: number; place: number; xp: number; coins: number; best: boolean } | null>(null)
  const seqRef = useRef(0)
  const correctRef = useRef(0)

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
    if (who === 0) { setQ(randomQ()); setPhase('question') } else { setPhase('ai-think') }
  }

  function playAgain() {
    setPositions(RACERS.map(() => START_SQUARE))
    setTurn(0)
    setQ(randomQ())
    setMove(null)
    setLastRoll(null)
    setCorrect(0)
    correctRef.current = 0
    setWinner(null)
    setReward(null)
    setPhase('question')
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
          <button aria-label="Back" onClick={() => navigate('/')}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="flex items-center gap-2 font-pixel text-[12px]" style={{ color: ACCENT }}>
            <Ladder width={16} height={16} aria-hidden />ASCEND
          </div>
          <div aria-hidden className="w-10 h-10" />
        </div>

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
          <QuestionPanel q={q} color={ACCENT} onSubmit={onAnswer} label="SOLVE TO EARN YOUR ROLL" />
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
            <div className="flex justify-center gap-3">
              <button onClick={playAgain}
                className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={ACCENT_BTN}>
                PLAY AGAIN
              </button>
              <button onClick={() => navigate('/')}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                ARCADE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}
