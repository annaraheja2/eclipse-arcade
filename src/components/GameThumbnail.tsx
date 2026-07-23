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

/* ---- Racer: side-on cartoon circuit, cars streaming past the grandstand.
   Composed inside y 24–96 — the cabinet screen is wider than the 200×120
   viewBox, so `slice` crops harder than the nominal 18–102 safe band. ---- */
function RacerThumb({ color }: { color: string }) {
  const car = (y: number, s: number, c: string, cls: string) => (
    <g className={cls}>
      <g transform={`translate(0 ${y}) scale(${s})`}>
        <rect x="0" y="-15" width="15" height="4" rx="1.5" fill={c} />
        <rect x="6" y="-12" width="3" height="7" fill="#10131a" />
        <path d="M4 -4 Q4 -8 10 -9 L19 -9 Q22 -12 27 -12 L33 -12 Q36 -11 38 -8 L50 -6 L56 -3 Q57 -2 55 -1 L48 0 L12 0 Q4 0 4 -4 Z" fill={c} />
        <circle cx="12" cy="0" r="5.5" fill="#191d25" /><circle cx="12" cy="0" r="2.4" fill="#d7dde8" />
        <circle cx="41" cy="0" r="5.5" fill="#191d25" /><circle cx="41" cy="0" r="2.4" fill="#d7dde8" />
        <rect x="50" y="2" width="12" height="2.5" rx="1.2" fill={c} />
      </g>
    </g>
  )
  return (
    <>
      <rect x="0" y="0" width="200" height="120" fill="#8ed6ff" />
      <circle cx="158" cy="34" r="9" fill="#ffd76a" />
      <path d="M0 60 L0 48 Q34 38 68 48 Q102 58 136 46 Q170 34 200 48 L200 60 Z" fill="#6fb877" />
      {/* grandstand */}
      <rect x="20" y="34" width="70" height="24" fill="#2b3346" />
      <path d="M15 34 L95 34 L90 28 L20 28 Z" fill="#e4322b" />
      {[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
        <rect key={`${r}-${c}`} x={25 + c * 6} y={38 + r * 5} width="3" height="3" rx="1.5" fill="#c9d4e4" />
      )))}
      {/* armco, run-off, kerb, road, verge */}
      <rect x="0" y="56" width="200" height="4" fill="#dfe6ef" />
      <rect x="0" y="60" width="200" height="4" fill="#49a94b" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <rect key={i} x={i * 20} y="64" width="20" height="4" fill={i % 2 ? '#f4f6fa' : '#e4322b'} />
      ))}
      <rect x="0" y="68" width="200" height="22" fill="#3c4250" />
      <rect x="0" y="90" width="200" height="30" fill="#34803f" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={10 + i * 56} y="79" width="24" height="2.5" rx="1.2" fill="#eef2f8" opacity="0.8" />)}
      {car(88, 0.62, color, 'tn-race1')}
      {car(78, 0.5, '#e4322b', 'tn-race2')}
      {car(72, 0.42, '#00c48c', 'tn-race3')}
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
