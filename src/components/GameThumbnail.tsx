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
    case 'cardgame': return <CardGameThumb color={g.color} />
    case 'ascend': return <AscendThumb color={g.color} />
    case 'laststanding': return <LastStandingThumb color={g.color} />
    case 'daily': return <DailyThumb color={g.color} />
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

/* ---- Card Game: a fanned hand, top card lifting off the discard ---- */
function CardGameThumb({ color }: { color: string }) {
  const hi = bright(color)
  // An ECLIPSE deck card: suit stock, fine gold inner border, a serif glyph.
  const card = (x: number, y: number, rot: number, fill: string, ink: string, glyph: string, delay?: string) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} className={delay !== undefined ? 'tn-bob' : undefined} style={delay !== undefined ? { animationDelay: delay } : undefined}>
      <rect x="-16" y="-24" width="32" height="48" rx="5" fill={fill} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
      <rect x="-13" y="-21" width="26" height="42" rx="3.5" fill="none" stroke="#c9a35c" strokeWidth="1" opacity="0.9" />
      <text x="0" y="7" textAnchor="middle" fontFamily='"Playfair Display", Georgia, serif' fontWeight="600" fontSize="20" fill={ink}>{glyph}</text>
    </g>
  )
  return (
    <>
      {/* fanned hand along the bottom — the four ECLIPSE suits */}
      {card(64, 92, -20, '#8a2f26', '#f2e4c4', '7')}
      {card(88, 98, -8, '#3d5234', '#f0e6c8', '4')}
      {card(112, 98, 8, '#1e2c46', '#f0e4c4', '2')}
      {card(136, 92, 20, '#eadfc0', '#26190e', '9')}
      {/* discard pile + a lifted accent card mid-play */}
      <g transform="translate(100 44) rotate(-6)">
        <rect x="-17" y="-25" width="34" height="50" rx="5" fill="#0d1424" stroke="#c9a35c" strokeWidth="1" />
      </g>
      {card(104, 40, 8, '#181328', '#e9dcba', '+2', '-0.6s')}
      <circle className="tn-ping" cx="104" cy="40" r="24" fill="none" stroke={hi} strokeWidth="2" />
    </>
  )
}

/* ---- Ascend: mini board grid, a glowing ladder, a snake, a bouncing die ---- */
function AscendThumb({ color }: { color: string }) {
  const hi = bright(color)
  return (
    <>
      {/* board grid */}
      {[40, 64, 88, 112, 136, 160].map((x) => <line key={`v${x}`} x1={x} y1="18" x2={x} y2="102" stroke={GRID} />)}
      {[18, 39, 60, 81, 102].map((y) => <line key={`h${y}`} x1="40" y1={y} x2="160" y2={y} stroke={GRID} />)}
      {/* ladder rising across the board */}
      <g stroke={hi} strokeWidth="3" strokeLinecap="round" className="tn-glowpulse">
        <line x1="58" y1="96" x2="102" y2="30" />
        <line x1="74" y1="98" x2="118" y2="32" />
        <line x1="64" y1="82" x2="80" y2="84" />
        <line x1="74" y1="66" x2="90" y2="68" />
        <line x1="84" y1="50" x2="100" y2="52" />
        <line x1="94" y1="35" x2="110" y2="37" />
      </g>
      {/* a snake sliding the other way */}
      <path d="M148 26 C 160 42 132 52 144 66 C 154 78 132 86 138 96"
        fill="none" stroke="#ff4d8d" strokeWidth="5" strokeLinecap="round" opacity="0.9" />
      <circle cx="148" cy="26" r="5" fill="#ff4d8d" />
      {/* the die, hopping */}
      <g className="tn-bob">
        <rect x="30" y="34" width="22" height="22" rx="5" fill="#f0f2f8" />
        <circle cx="36.5" cy="40.5" r="2" fill="#1a1030" />
        <circle cx="45.5" cy="49.5" r="2" fill="#1a1030" />
        <circle cx="45.5" cy="40.5" r="2" fill="#1a1030" />
        <circle cx="36.5" cy="49.5" r="2" fill="#1a1030" />
      </g>
    </>
  )
}

/* ---- Last Standing: seats around a table — one crowned + glowing, one
   eliminated seat crossed out, the shrinking clock ticking down ---- */
function LastStandingThumb({ color }: { color: string }) {
  const hi = bright(color)
  const figure = (x: number, y: number, fill: string, opacity = 1) => (
    <g opacity={opacity}>
      <circle cx={x} cy={y - 10} r="5" fill={fill} />
      <path d={`M${x - 7} ${y + 4} a7 7 0 0 1 14 0 z`} fill={fill} />
    </g>
  )
  return (
    <>
      {/* the table */}
      <ellipse cx="100" cy="66" rx="34" ry="15" fill="#1c1140" stroke={color} strokeOpacity="0.65" strokeWidth="2" />
      {/* winner at the head, crowned + pulsing */}
      <g className="tn-glowpulse">
        {figure(100, 36, hi)}
        <path d="M93 20.5 94.5 15l3.5 2.7 2-4 2 4 3.5-2.7 1.5 5.5z" fill="#ffb43d" />
      </g>
      <circle className="tn-ping" cx="100" cy="32" r="14" fill="none" stroke={hi} strokeWidth="2" />
      {/* rivals around the table; the right seat is banished — faded + struck */}
      {figure(56, 58, 'rgba(255,255,255,0.7)')}
      {figure(70, 84, 'rgba(255,255,255,0.55)')}
      {figure(130, 84, 'rgba(255,255,255,0.55)')}
      {figure(144, 58, 'rgba(255,255,255,0.35)', 0.6)}
      <g stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <line x1="136" y1="44" x2="152" y2="60" />
        <line x1="152" y1="44" x2="136" y2="60" />
      </g>
      {/* the shrinking clock */}
      <circle cx="36" cy="36" r="12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
      <path className="tn-glowpulse" d="M36 36 36 27 A9 9 0 0 1 44.2 39.5 z" fill={color} opacity="0.85" />
      <line x1="36" y1="36" x2="36" y2="28" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
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

/* ---- fallback: pulsing starburst in the game's accent ---- */
function DefaultThumb({ color }: { color: string }) {
  return (
    <g className="tn-glowpulse">
      <circle cx="100" cy="60" r="22" fill={color} opacity="0.3" />
      <circle cx="100" cy="60" r="10" fill={bright(color)} />
    </g>
  )
}
