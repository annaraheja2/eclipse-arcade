import { useRef } from 'react'

const W = 640
const PAD = 40
const H = 120

export default function SliderBoard({
  min, max, step, guess, answer, onPlace, disabled, color, light = false,
}: {
  min: number; max: number; step: number
  guess: number | null
  answer: number | null // set when revealed
  onPlace: (v: number) => void
  disabled?: boolean
  color: string
  light?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const span = max - min
  const toX = (v: number) => PAD + ((v - min) / span) * (W - 2 * PAD)

  function place(clientX: number) {
    if (disabled || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const px = ((clientX - rect.left) / rect.width) * W
    let v = min + ((px - PAD) / (W - 2 * PAD)) * span
    v = Math.round(v / step) * step
    onPlace(Math.max(min, Math.min(max, v)))
  }

  // integer ticks (skip if too many)
  const ticks: number[] = []
  const tickEvery = span <= 25 ? 1 : Math.ceil(span / 20)
  for (let v = Math.ceil(min); v <= max; v += tickEvery) ticks.push(v)

  // On a light surface (Racer's white card) the neon-on-dark axis is illegible,
  // so the axis line and tick labels switch to dark-on-light (labels hit AA as
  // text). The handle keeps the game accent (visible >=3:1 on white). The dark
  // path (Battleship) keeps the exact original values.
  const axisLine = light ? 'rgba(10,6,32,0.35)' : 'rgba(255,255,255,0.35)'
  const tickLine = light ? 'rgba(10,6,32,0.25)' : 'rgba(255,255,255,0.25)'
  const tickText = light ? 'rgba(10,6,32,0.7)' : 'rgba(255,255,255,0.4)'

  const y = H / 2
  const gx = guess !== null ? toX(guess) : null
  const ax = answer !== null ? toX(answer) : null

  return (
    <svg
      ref={ref} viewBox={`0 0 ${W} ${H}`} onClick={(e) => place(e.clientX)}
      className={`w-full max-w-[640px] mx-auto rounded-xl border ${light ? 'bg-black/[0.04] border-black/15' : 'bg-black/30 border-white/10'} ${disabled ? '' : 'cursor-pointer'}`}
    >
      <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={axisLine} strokeWidth={2} />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={toX(v)} y1={y - 6} x2={toX(v)} y2={y + 6} stroke={tickLine} strokeWidth={1.5} />
          <text x={toX(v)} y={y + 24} textAnchor="middle" fontSize="12" fill={tickText}>{v}</text>
        </g>
      ))}
      {ax !== null && gx !== null && <line x1={gx} y1={y - 26} x2={ax} y2={y - 26} stroke="white" strokeDasharray="4 4" strokeOpacity={0.5} />}
      {gx !== null && (
        <g>
          <path d={`M ${gx} ${y - 12} l -8 -14 h 16 z`} fill={color} />
          <circle cx={gx} cy={y} r={5} fill={color} />
        </g>
      )}
      {ax !== null && (
        <g>
          <path d={`M ${ax} ${y + 12} l -8 14 h 16 z`} fill="#3dffa2" />
          <circle cx={ax} cy={y} r={5} fill="#3dffa2" />
        </g>
      )}
    </svg>
  )
}
