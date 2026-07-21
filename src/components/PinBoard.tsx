import { useRef } from 'react'

const SIZE = 360

export default function PinBoard({
  range, guess, answer, onPlace, disabled, color,
}: {
  range: number
  guess: { x: number; y: number } | null
  answer: { x: number; y: number } | null // set when revealed
  onPlace: (x: number, y: number) => void
  disabled?: boolean
  color: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const scale = SIZE / (2 * range)
  const cx = SIZE / 2
  const toSvg = (x: number, y: number): [number, number] => [cx + x * scale, cx - y * scale]

  function click(e: React.MouseEvent) {
    if (disabled || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * SIZE
    const py = ((e.clientY - rect.top) / rect.height) * SIZE
    const x = Math.round(((px - cx) / scale) * 2) / 2
    const y = Math.round(((cx - py) / scale) * 2) / 2
    onPlace(Math.max(-range, Math.min(range, x)), Math.max(-range, Math.min(range, y)))
  }

  const lines = []
  for (let i = -range; i <= range; i++) {
    const [sx] = toSvg(i, 0)
    const [, sy] = toSvg(0, i)
    const major = i === 0
    lines.push(<line key={`v${i}`} x1={sx} y1={0} x2={sx} y2={SIZE} stroke={major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)'} strokeWidth={major ? 1.5 : 1} />)
    lines.push(<line key={`h${i}`} x1={0} y1={sy} x2={SIZE} y2={sy} stroke={major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)'} strokeWidth={major ? 1.5 : 1} />)
  }

  const gp = guess ? toSvg(guess.x, guess.y) : null
  const ap = answer ? toSvg(answer.x, answer.y) : null

  return (
    <svg
      ref={ref} viewBox={`0 0 ${SIZE} ${SIZE}`} onClick={click}
      className={`w-full max-w-[360px] mx-auto rounded-xl bg-black/30 border border-white/10 ${disabled ? '' : 'cursor-crosshair'}`}
    >
      {lines}
      {ap && gp && <line x1={gp[0]} y1={gp[1]} x2={ap[0]} y2={ap[1]} stroke="white" strokeDasharray="4 4" strokeOpacity={0.6} />}
      {gp && (
        <g style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
          {/* targeting reticle */}
          <circle cx={gp[0]} cy={gp[1]} r={12} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9} />
          <line x1={gp[0] - 18} y1={gp[1]} x2={gp[0] - 5} y2={gp[1]} stroke={color} strokeWidth={1.5} />
          <line x1={gp[0] + 5} y1={gp[1]} x2={gp[0] + 18} y2={gp[1]} stroke={color} strokeWidth={1.5} />
          <line x1={gp[0]} y1={gp[1] - 18} x2={gp[0]} y2={gp[1] - 5} stroke={color} strokeWidth={1.5} />
          <line x1={gp[0]} y1={gp[1] + 5} x2={gp[0]} y2={gp[1] + 18} stroke={color} strokeWidth={1.5} />
          <circle cx={gp[0]} cy={gp[1]} r={2.5} fill={color} />
        </g>
      )}
      {ap && (
        <g>
          <circle cx={ap[0]} cy={ap[1]} r={9} fill="none" stroke="#3dffa2" strokeWidth={2} />
          <circle cx={ap[0]} cy={ap[1]} r={3} fill="#3dffa2" />
        </g>
      )}
    </svg>
  )
}
