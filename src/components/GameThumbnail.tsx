import type { GameDef } from '../lib/games'

// Animated mini-preview of each game's actual mechanic, rendered inside the
// cabinet screen. Pure SVG + CSS keyframes (classes prefixed `tn-` in
// index.css) — no per-frame JS, and every animation pauses under
// prefers-reduced-motion. Decorative: the cabinet button already carries the
// game name, so the whole SVG is aria-hidden.
//
// Art is designed inside the vertical "safe band" y 18–102 of the 200×120
// viewBox, because `slice` crops top/bottom at wide cabinet aspect ratios.
export default function GameThumbnail({ g }: { g: GameDef }) {
  return (
    <svg className="tn" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {pick(g)}
    </svg>
  )
}

function pick(g: GameDef): JSX.Element {
  switch (g.key) {
    case 'battleship': return <BattleshipThumb />
    case 'racer': return <RacerThumb color={g.color} />
    case 'daily': return <DailyThumb color={g.color} />
    case 'pinpoint': return <PinPointThumb color={g.color} />
    case 'slider': return <SliderThumb color={g.color} />
    case 'gridfill': return <GridFillThumb color={g.color} />
    case 'matchup': return <MatchUpThumb color={g.color} />
    case 'fitline': return <FitLineThumb color={g.color} />
    default: return <DefaultThumb color={g.color} />
  }
}

const GRID = 'rgba(255,255,255,0.08)'
const bright = (c: string) => `color-mix(in srgb, ${c} 70%, #fff)`

/* ---- Battleship: mini ocean grid, gray fleet, a hit ablaze + a miss ---- */
function BattleshipThumb() {
  return (
    <>
      <defs>
        <linearGradient id="tn-bs-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f6191" />
          <stop offset="1" stopColor="#06283f" />
        </linearGradient>
      </defs>
      <rect width="200" height="120" fill="url(#tn-bs-sea)" />
      {[25, 50, 75, 100, 125, 150, 175].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="120" stroke={GRID} />)}
      {[24, 48, 72, 96].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke={GRID} />)}
      {/* drifting swells */}
      <g className="tn-wave">
        <path d="M-10 34 Q 15 28 40 34 T 90 34 T 140 34 T 190 34 T 240 34" fill="none" stroke="#bfe8ff" strokeOpacity="0.22" strokeWidth="2" />
        <path d="M-10 100 Q 15 94 40 100 T 90 100 T 140 100 T 190 100 T 240 100" fill="none" stroke="#bfe8ff" strokeOpacity="0.14" strokeWidth="2" />
      </g>
      {/* horizontal cruiser */}
      <g className="tn-bob">
        <path d="M32 58 h48 l9 -8 v-3 h-6 l-4 4 h-47 a6 6 0 0 0 0 14 z" transform="translate(0,4)" fill="#8fa3b8" />
        <rect x="48" y="48" width="16" height="8" rx="2" fill="#6b7d92" />
        <rect x="54" y="43" width="4" height="6" fill="#55677c" />
      </g>
      {/* vertical patrol boat, on fire at the bow */}
      <g className="tn-bob" style={{ animationDelay: '-1.6s' }}>
        <path d="M150 66 a8 8 0 0 1 16 0 v26 a8 8 0 0 1 -16 0 z" fill="#7e8ea0" />
        <circle cx="158" cy="84" r="4" fill="#5f7186" />
      </g>
      <circle className="tn-ping" cx="158" cy="68" r="12" fill="none" stroke="#ffb43d" strokeWidth="2" />
      <g className="tn-flame">
        <circle cx="158" cy="68" r="8" fill="#ff5a1f" opacity="0.85" />
        <circle cx="158" cy="66" r="4" fill="#ffe23d" />
      </g>
      {/* a miss: pale splash ring */}
      <circle cx="62" cy="86" r="3" fill="rgba(225,242,255,0.75)" />
      <circle className="tn-ping" style={{ animationDelay: '-0.9s' }} cx="62" cy="86" r="9" fill="none" stroke="rgba(225,242,255,0.6)" strokeWidth="1.5" />
    </>
  )
}

/* ---- Racer: three neon lanes, cars cruising toward a checkered finish ---- */
function RacerThumb({ color }: { color: string }) {
  const laneY = [40, 62, 84]
  const carColors = [color, '#ff3df0', '#3dffa2']
  const anim = ['tn-race1', 'tn-race2', 'tn-race3']
  const car = (y: number, c: number, cls: string) => (
    <g key={y} className={cls}>
      <rect x="18" y={y - 7} width="26" height="12" rx="4" fill={carColors[c]} />
      <rect x="24" y={y - 10} width="12" height="6" rx="2" fill={carColors[c]} opacity="0.85" />
      <circle cx="24" cy={y + 5} r="3" fill="#0a0620" />
      <circle cx="38" cy={y + 5} r="3" fill="#0a0620" />
    </g>
  )
  return (
    <>
      {/* lanes */}
      {laneY.map((y) => (
        <g key={y}>
          <line x1="0" y1={y + 8} x2="200" y2={y + 8} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
          <line x1="0" y1={y - 9} x2="200" y2={y - 9} stroke={color} strokeOpacity="0.18" strokeWidth="1" strokeDasharray="10 8" />
        </g>
      ))}
      {/* checkered finish line */}
      {[0, 1, 2, 3, 4, 5].map((r) => (
        <rect key={r} x={r % 2 ? 176 : 168} y={30 + r * 11} width="8" height="11" fill={r % 2 ? '#e9edff' : '#0a0620'} />
      ))}
      <rect x="168" y="30" width="16" height="66" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      {laneY.map((y, i) => car(y, i, anim[i]))}
    </>
  )
}

/* ---- Daily: calendar card, today lit with a star, sheen sweep ---- */
function DailyThumb({ color }: { color: string }) {
  const cells: JSX.Element[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const today = r === 1 && c === 3
      cells.push(
        <rect key={`${r}${c}`} x={64 + c * 15.5} y={48 + r * 15.5} width="11" height="11" rx="2.5"
          fill={today ? color : 'rgba(255,255,255,0.13)'}
          className={today ? 'tn-glowpulse' : undefined} />,
      )
    }
  }
  return (
    <>
      <rect x="55" y="18" width="90" height="86" rx="8" fill="#171033" stroke="rgba(255,255,255,0.18)" />
      <path d="M55 26 a8 8 0 0 1 8 -8 h74 a8 8 0 0 1 8 8 v12 h-90 z" fill={color} opacity="0.9" />
      <circle cx="72" cy="18" r="2.5" fill="#171033" stroke="rgba(255,255,255,0.4)" />
      <circle cx="128" cy="18" r="2.5" fill="#171033" stroke="rgba(255,255,255,0.4)" />
      {cells}
      {/* star on today's cell */}
      <path d="m116.6 66.6 1.3 2.7 2.9.3-2.2 2 .7 2.9-2.7-1.5-2.7 1.5.7-2.9-2.2-2 2.9-.3z" fill="#2a1a00" />
      <rect className="tn-shine" x="-42" y="0" width="20" height="120" fill="rgba(255,255,255,0.16)" />
    </>
  )
}

/* ---- PinPoint: coordinate plane, roaming crosshair, landed pin ---- */
function PinPointThumb({ color }: { color: string }) {
  const hi = bright(color)
  return (
    <>
      {[20, 40, 60, 80, 120, 140, 160, 180].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="120" stroke={GRID} />)}
      {[20, 40, 80, 100].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke={GRID} />)}
      <line x1="100" y1="0" x2="100" y2="120" stroke={color} strokeOpacity="0.55" strokeWidth="1.5" />
      <line x1="0" y1="60" x2="200" y2="60" stroke={color} strokeOpacity="0.55" strokeWidth="1.5" />
      {/* landed pin at (140, 40) */}
      <circle className="tn-ping" cx="140" cy="40" r="13" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="140" cy="40" r="9" fill={color} opacity="0.28" className="tn-glowpulse" />
      <circle cx="140" cy="40" r="4.5" fill={hi} />
      {/* crosshair drifting near (66, 82) */}
      <g className="tn-drift" stroke={hi} strokeWidth="1.8" fill="none">
        <circle cx="66" cy="82" r="10" />
        <line x1="66" y1="66" x2="66" y2="76" />
        <line x1="66" y1="88" x2="66" y2="98" />
        <line x1="50" y1="82" x2="60" y2="82" />
        <line x1="72" y1="82" x2="82" y2="82" />
      </g>
    </>
  )
}

/* ---- Slider: number line, target tick, glowing handle easing in ---- */
function SliderThumb({ color }: { color: string }) {
  const hi = bright(color)
  return (
    <>
      <line x1="16" y1="66" x2="184" y2="66" stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round" />
      {[16, 44, 72, 100, 128, 156, 184].map((x) => (
        <line key={x} x1={x} y1="60" x2={x} y2="72" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
      ))}
      {/* target tick */}
      <line className="tn-glowpulse" x1="142" y1="52" x2="142" y2="80" stroke={hi} strokeWidth="3" strokeLinecap="round" />
      <path d="m142 44 5 6 h-10 z" fill={hi} className="tn-glowpulse" />
      {/* handle sliding toward the target */}
      <g className="tn-slide">
        <circle cx="112" cy="66" r="13" fill={color} opacity="0.25" />
        <circle cx="112" cy="66" r="8" fill={color} />
        <circle cx="109.5" cy="63.5" r="2.5" fill="rgba(255,255,255,0.75)" />
      </g>
      <text x="16" y="94" fontFamily='"Press Start 2P", monospace' fontSize="7" fill="rgba(255,255,255,0.6)">0</text>
      <text x="176" y="94" fontFamily='"Press Start 2P", monospace' fontSize="7" fill="rgba(255,255,255,0.6)">12</text>
    </>
  )
}

/* ---- Grid-Fill (soon): cells lighting up in sequence ---- */
function GridFillThumb({ color }: { color: string }) {
  const filled = new Set([1, 2, 5, 6, 9, 10, 11])
  const blinkDelay: Record<number, string> = { 6: '0s', 10: '-0.8s', 11: '-1.6s' }
  const cells: JSX.Element[] = []
  for (let i = 0; i < 16; i++) {
    const c = i % 4, r = Math.floor(i / 4)
    const x = 58 + c * 22, y = 18 + r * 22
    const on = filled.has(i)
    cells.push(
      <rect key={i} x={x} y={y} width="18" height="18" rx="3.5"
        fill={on ? color : 'transparent'} fillOpacity={on ? 0.8 : 0}
        stroke={on ? bright(color) : 'rgba(255,255,255,0.22)'} strokeWidth="1.5"
        className={i in blinkDelay ? 'tn-cellblink' : undefined}
        style={i in blinkDelay ? { animationDelay: blinkDelay[i] } : undefined} />,
    )
  }
  return <>{cells}</>
}

/* ---- Match-Up (soon): two columns, a pair-line drawing itself ---- */
function MatchUpThumb({ color }: { color: string }) {
  const hi = bright(color)
  const node = (x: number, y: number, key: string) => (
    <circle key={key} cx={x} cy={y} r="7.5" fill="rgba(255,255,255,0.12)" stroke={hi} strokeWidth="2" />
  )
  return (
    <>
      <line x1="68" y1="30" x2="132" y2="60" stroke={color} strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="68" y1="90" x2="132" y2="90" stroke={color} strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" />
      <line className="tn-draw" x1="68" y1="60" x2="132" y2="30" stroke={hi} strokeWidth="3" strokeLinecap="round" />
      {node(60, 30, 'l1')}{node(60, 60, 'l2')}{node(60, 90, 'l3')}
      {node(140, 30, 'r1')}{node(140, 60, 'r2')}{node(140, 90, 'r3')}
    </>
  )
}

/* ---- Fit-the-Line (soon): scatter plot, best-fit line settling in ---- */
function FitLineThumb({ color }: { color: string }) {
  const hi = bright(color)
  const pts: Array<[number, number]> = [[42, 90], [68, 72], [92, 80], [118, 54], [146, 44], [166, 30]]
  return (
    <>
      {[40, 80, 120, 160].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="120" stroke={GRID} />)}
      {[30, 60, 90].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke={GRID} />)}
      <g className="tn-fit">
        <line x1="26" y1="102" x2="180" y2="24" stroke={color} strokeWidth="8" strokeOpacity="0.2" strokeLinecap="round" />
        <line x1="26" y1="102" x2="180" y2="24" stroke={hi} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill={hi} />)}
    </>
  )
}

/* ---- fallback: pulsing starburst in the game's accent ---- */
function DefaultThumb({ color }: { color: string }) {
  return (
    <g className="tn-glowpulse">
      <circle cx="100" cy="60" r="22" fill={color} opacity="0.3" />
      <circle cx="100" cy="60" r="10" fill={bright(color)} />
    </g>
  )
}
