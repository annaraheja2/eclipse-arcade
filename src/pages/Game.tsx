import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { getGame, pickRounds, scorePin, scoreSlider, ROUND_MAX, type Round } from '../lib/games'
import { usePlayer } from '../lib/player'
import PinBoard from '../components/PinBoard'
import SliderBoard from '../components/SliderBoard'
import Controller from '../components/Controller'
import Avatar, { type Mood } from '../components/Avatar'
import { ArrowLeft, Replay, Coin, Bolt } from '../icons'

type Aim = { x: number; y: number } | number
const TOTAL_ROUNDS = 5
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function message(pts: number): string {
  if (pts >= 950) return 'BULLSEYE!'
  if (pts >= 780) return 'Nailed it!'
  if (pts >= 500) return 'Nice!'
  if (pts >= 250) return 'So close!'
  return 'Keep going'
}
function defaultAim(r: Round): Aim {
  return r.kind === 'pin' ? { x: 0, y: 0 } : Math.round(((r.min + r.max) / 2) / r.step) * r.step
}

export default function Game() {
  const { gameKey = '' } = useParams()
  const navigate = useNavigate()
  const { finishGame } = usePlayer()
  const game = getGame(gameKey)

  const [seed, setSeed] = useState(0)
  const rounds = useMemo(() => (game ? pickRounds(game, TOTAL_ROUNDS) : []), [game, seed])

  const [idx, setIdx] = useState(0)
  const [aim, setAim] = useState<Aim>(0)
  const [revealed, setRevealed] = useState(false)
  const [pts, setPts] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const [rewards, setRewards] = useState<{ xp: number; coins: number; best: boolean } | null>(null)

  const round: Round | undefined = rounds[idx]

  // Reset the crosshair each new round.
  useEffect(() => { if (round) { setAim(defaultAim(round)); setRevealed(false) } }, [idx, seed]) // eslint-disable-line

  function move(dx: number, dy: number) {
    if (revealed || !round) return
    setAim((a) => {
      if (round.kind === 'pin') {
        const p = a as { x: number; y: number }
        return { x: clamp(p.x + dx * 0.5, -round.range, round.range), y: clamp(p.y + dy * 0.5, -round.range, round.range) }
      }
      return clamp((a as number) + dx * round.step, round.min, round.max)
    })
  }
  function submit() {
    if (revealed || !round) return
    const p = round.kind === 'pin'
      ? scorePin(round, (aim as { x: number; y: number }).x, (aim as { x: number; y: number }).y)
      : scoreSlider(round, aim as number)
    setPts((a) => [...a, p]); setRevealed(true)
  }
  function next() {
    if (idx < TOTAL_ROUNDS - 1) setIdx(idx + 1)
    else { const t = pts.reduce((a, b) => a + b, 0); setRewards(finishGame(game!.key, t)); setDone(true) }
  }
  function restart() { setSeed((s) => s + 1); setIdx(0); setPts([]); setDone(false); setRevealed(false); setRewards(null) }

  // Keyboard controls
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return
      if (e.key === 'ArrowUp') { move(0, 1); e.preventDefault() }
      else if (e.key === 'ArrowDown') { move(0, -1); e.preventDefault() }
      else if (e.key === 'ArrowLeft') { move(-1, 0); e.preventDefault() }
      else if (e.key === 'ArrowRight') { move(1, 0); e.preventDefault() }
      else if (e.key === ' ' || e.key === 'Enter') { revealed ? next() : submit(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!game || game.type === 'soon') return <Navigate to="/" replace />

  const total = pts.reduce((a, b) => a + b, 0)
  const lastPts = revealed ? pts[pts.length - 1] : null
  const mood: Mood = revealed ? ((lastPts ?? 0) >= 500 ? 'happy' : 'sad') : 'aim'

  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => navigate('/')} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="text-center">
            <div className="font-pixel text-[11px]" style={{ color: game.color }}>{game.name.toUpperCase()}</div>
            {!done && <div className="text-xs text-white/50 mt-1">Round {idx + 1} / {TOTAL_ROUNDS}</div>}
          </div>
          <div className="w-10 text-right text-sm font-bold tabular-nums" style={{ color: game.color }}>{total}</div>
        </div>

        {done ? (
          <Results total={total} pts={pts} rewards={rewards} color={game.color} onReplay={restart} onHome={() => navigate('/')} />
        ) : round ? (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4 text-center min-h-[72px] grid place-items-center">
              <p className="text-lg font-semibold">{round.prompt}</p>
            </div>

            <div className="mb-4">
              {round.kind === 'pin'
                ? <PinBoard range={round.range} color={game.color} disabled={revealed} guess={aim as { x: number; y: number }} answer={revealed ? { x: round.x, y: round.y } : null} onPlace={(x, y) => setAim({ x, y })} />
                : <SliderBoard min={round.min} max={round.max} step={round.step} color={game.color} disabled={revealed} guess={aim as number} answer={revealed ? round.answer : null} onPlace={(v) => setAim(v)} />}
            </div>

            {revealed ? (
              <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <Avatar mood={mood} color={game.color} size={64} />
                <div className="flex-1">
                  <div className="font-pixel text-[11px]" style={{ color: game.color }}>{message(lastPts ?? 0)}</div>
                  <div className="text-3xl font-extrabold tabular-nums neon-text" style={{ color: game.color }}>+{lastPts}</div>
                  <div className="text-xs text-white/40">{round.kind === 'pin' ? `Answer: (${round.x}, ${round.y})` : `Answer: ${round.answer}`}</div>
                </div>
                <button onClick={next} className="font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={{ background: game.color, boxShadow: `0 0 18px ${game.color}88` }}>
                  {idx < TOTAL_ROUNDS - 1 ? 'NEXT' : 'RESULTS'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="shrink-0"><Avatar mood="aim" color={game.color} size={72} /></div>
                <div className="flex-1">
                  <Controller mode={round.kind === 'pin' ? 'pad' : 'lr'} color={game.color} onMove={move} onFire={submit} fireLabel="FIRE" />
                </div>
              </div>
            )}
            <p className="text-center text-[11px] text-white/30 mt-3">Steer with the D-pad or arrow keys · FIRE / Space to lock in</p>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Results({ total, pts, rewards, color, onReplay, onHome }: {
  total: number; pts: number[]; rewards: { xp: number; coins: number; best: boolean } | null; color: string
  onReplay: () => void; onHome: () => void
}) {
  const good = total >= pts.length * 500
  return (
    <div className="text-center">
      <div className="flex justify-center mb-3"><Avatar mood={good ? 'happy' : 'sad'} color={color} size={84} /></div>
      <div className="font-pixel text-[12px] text-white/60 mb-2">FINAL SCORE</div>
      <div className="text-6xl font-extrabold tabular-nums neon-text mb-1" style={{ color }}>{total}</div>
      <div className="text-xs text-white/40 mb-1">out of {ROUND_MAX * pts.length}</div>
      {rewards?.best && <div className="inline-block font-pixel text-[9px] px-2 py-1 rounded bg-neon-amber text-[#2a1a00] mb-3">NEW BEST!</div>}

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
