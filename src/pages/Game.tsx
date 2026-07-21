import { useMemo, useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { getGame, pickRounds, scorePin, scoreSlider, ROUND_MAX, type Round } from '../lib/games'
import { usePlayer } from '../lib/player'
import PinBoard from '../components/PinBoard'
import SliderBoard from '../components/SliderBoard'
import { ArrowLeft, Replay, Coin, Bolt } from '../icons'

type Guess = { x: number; y: number } | number | null

const TOTAL_ROUNDS = 5

function message(pts: number): string {
  if (pts >= 950) return 'BULLSEYE!'
  if (pts >= 780) return 'Nailed it!'
  if (pts >= 500) return 'Nice!'
  if (pts >= 250) return 'So close!'
  return 'Keep going'
}

export default function Game() {
  const { gameKey = '' } = useParams()
  const navigate = useNavigate()
  const { finishGame } = usePlayer()
  const game = getGame(gameKey)

  const [seed, setSeed] = useState(0)
  const rounds = useMemo(() => (game ? pickRounds(game, TOTAL_ROUNDS) : []), [game, seed])

  const [idx, setIdx] = useState(0)
  const [guess, setGuess] = useState<Guess>(null)
  const [revealed, setRevealed] = useState(false)
  const [pts, setPts] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const [rewards, setRewards] = useState<{ xp: number; coins: number; best: boolean } | null>(null)

  if (!game || game.type === 'soon') return <Navigate to="/" replace />

  const round = rounds[idx]
  const total = pts.reduce((a, b) => a + b, 0)

  function submit() {
    if (guess === null) return
    const p = round.kind === 'pin'
      ? scorePin(round, (guess as { x: number; y: number }).x, (guess as { x: number; y: number }).y)
      : scoreSlider(round, guess as number)
    setPts((a) => [...a, p])
    setRevealed(true)
  }

  function next() {
    if (idx < TOTAL_ROUNDS - 1) {
      setIdx(idx + 1); setGuess(null); setRevealed(false)
    } else {
      const finalTotal = pts.reduce((a, b) => a + b, 0)
      setRewards(finishGame(game!.key, finalTotal))
      setDone(true)
    }
  }

  function restart() {
    setSeed((s) => s + 1); setIdx(0); setGuess(null); setRevealed(false); setPts([]); setDone(false); setRewards(null)
  }

  const lastPts = revealed ? pts[pts.length - 1] : null

  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        {/* top bar */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/')} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="text-center">
            <div className="font-pixel text-[11px]" style={{ color: game.color }}>{game.name.toUpperCase()}</div>
            {!done && <div className="text-xs text-white/50 mt-1">Round {idx + 1} / {TOTAL_ROUNDS}</div>}
          </div>
          <div className="w-10 text-right text-sm font-bold tabular-nums" style={{ color: game.color }}>{total}</div>
        </div>

        {done ? (
          <Results total={total} pts={pts} rewards={rewards} color={game.color} onReplay={restart} onHome={() => navigate('/')} />
        ) : (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-5 text-center min-h-[76px] grid place-items-center">
              <p className="text-lg font-semibold">{round.prompt}</p>
            </div>

            <Board round={round} guess={guess} revealed={revealed} onPlace={setGuess} color={game.color} />

            <div className="mt-5">
              {revealed ? (
                <div className="text-center space-y-3">
                  <div className="font-pixel text-[12px]" style={{ color: game.color }}>{message(lastPts ?? 0)}</div>
                  <div className="text-3xl font-extrabold tabular-nums neon-text" style={{ color: game.color }}>+{lastPts}</div>
                  <div className="text-xs text-white/40">{answerText(round)}</div>
                  <button onClick={next} className="mt-1 font-pixel text-[11px] px-6 py-3 rounded-lg text-[#0a0620]" style={{ background: game.color, boxShadow: `0 0 18px ${game.color}88` }}>
                    {idx < TOTAL_ROUNDS - 1 ? 'NEXT' : 'RESULTS'}
                  </button>
                </div>
              ) : (
                <button onClick={submit} disabled={guess === null}
                  className="w-full font-pixel text-[11px] py-4 rounded-xl text-[#0a0620] disabled:opacity-40 transition"
                  style={{ background: game.color, boxShadow: guess === null ? 'none' : `0 0 18px ${game.color}88` }}>
                  {guess === null ? 'PLACE YOUR GUESS' : 'SUBMIT'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Board({ round, guess, revealed, onPlace, color }: { round: Round; guess: Guess; revealed: boolean; onPlace: (g: Guess) => void; color: string }) {
  if (round.kind === 'pin') {
    return <PinBoard range={round.range} color={color} disabled={revealed}
      guess={guess as { x: number; y: number } | null}
      answer={revealed ? { x: round.x, y: round.y } : null}
      onPlace={(x, y) => onPlace({ x, y })} />
  }
  return <SliderBoard min={round.min} max={round.max} step={round.step} color={color} disabled={revealed}
    guess={guess as number | null}
    answer={revealed ? round.answer : null}
    onPlace={(v) => onPlace(v)} />
}

function answerText(r: Round): string {
  return r.kind === 'pin' ? `Answer: (${r.x}, ${r.y})` : `Answer: ${r.answer}`
}

function Results({ total, pts, rewards, color, onReplay, onHome }: {
  total: number; pts: number[]; rewards: { xp: number; coins: number; best: boolean } | null; color: string
  onReplay: () => void; onHome: () => void
}) {
  return (
    <div className="text-center">
      <div className="font-pixel text-[12px] text-white/60 mb-2">FINAL SCORE</div>
      <div className="text-6xl font-extrabold tabular-nums neon-text mb-1" style={{ color }}>{total}</div>
      <div className="text-xs text-white/40 mb-1">out of {ROUND_MAX * pts.length}</div>
      {rewards?.best && <div className="inline-block font-pixel text-[9px] px-2 py-1 rounded bg-neon-amber text-[#2a1a00] mb-4">NEW BEST!</div>}

      <div className="flex justify-center gap-3 my-5">
        <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-neon-amber font-semibold"><Coin width={18} height={18} /> +{rewards?.coins ?? 0}</span>
        <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-neon-cyan font-semibold"><Bolt width={18} height={18} /> +{rewards?.xp ?? 0} XP</span>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-6 max-w-xs mx-auto">
        {pts.map((p, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-white/50">Round {i + 1}</span>
            <span className="font-bold tabular-nums" style={{ color: p >= 780 ? '#3dffa2' : p >= 400 ? color : '#ff6b3d' }}>{p}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-3">
        <button onClick={onReplay} className="flex items-center gap-2 font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={{ background: color, boxShadow: `0 0 18px ${color}88` }}>
          <Replay width={16} height={16} /> PLAY AGAIN
        </button>
        <button onClick={onHome} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">ARCADE</button>
      </div>
    </div>
  )
}
