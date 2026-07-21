// A stylized warship drawn to fill its cell-span box. Horizontal by default; rotates for vertical.
export default function Warship({ size, horiz, sunk }: { size: number; horiz: boolean; sunk: boolean }) {
  // Draw horizontally in a 0..(size*20) x 20 viewBox, then rotate the whole SVG for vertical.
  const L = size * 20
  const hull = sunk ? '#5b2b2b' : '#7c8894'
  const hullDark = sunk ? '#3a1c1c' : '#515b66'
  const deck = sunk ? '#803a3a' : '#9aa6b2'

  return (
    <svg
      viewBox={`0 0 ${L} 20`}
      preserveAspectRatio="none"
      className="w-full h-full"
      style={{ transform: horiz ? 'none' : 'rotate(90deg)', filter: sunk ? 'grayscale(0.3)' : 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))' }}
    >
      <defs>
        <linearGradient id={`g${size}${horiz}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={deck} /><stop offset="1" stopColor={hullDark} />
        </linearGradient>
      </defs>
      {/* hull */}
      <path d={`M2 12 L6 6 L${L - 8} 6 L${L - 2} 10 L${L - 8} 15 L6 15 Z`} fill={`url(#g${size}${horiz})`} stroke={hullDark} strokeWidth="0.6" />
      {/* deck line */}
      <line x1="7" y1="8.5" x2={L - 9} y2="8.5" stroke={hull} strokeWidth="1.2" />
      {/* bridge */}
      <rect x={L * 0.42} y="3.5" width={L * 0.14} height="4" rx="1" fill={hullDark} />
      {/* turrets */}
      <circle cx={L * 0.24} cy="9" r="1.8" fill={hullDark} />
      <circle cx={L * 0.7} cy="9" r="1.8" fill={hullDark} />
      {/* gun barrel at bow */}
      <line x1={L - 8} y1="10.5" x2={L - 1} y2="10.5" stroke={hullDark} strokeWidth="1" />
      {sunk && <line x1="4" y1="4" x2={L - 4} y2="16" stroke="#ff5a5a" strokeWidth="1.4" opacity="0.8" />}
    </svg>
  )
}
