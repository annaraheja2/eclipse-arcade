// Top-down "molded plastic" warship art in the spirit of the classic tabletop
// Battleship pieces: matte gray hulls with bevelled edges lit from the top-left,
// raised gray superstructure with ambient occlusion at its base, faint peg-hole
// hints at each cell center, and only a whisper of cyan rim-light so the pieces
// still belong on the neon board. Art is authored horizontally (bow right) in a
// viewBox matching the true N-cell footprint; vertical ships rotate the whole
// drawing in SVG space (bow up) so a length-N ship always spans exactly N cells,
// undistorted, in both orientations.
import { useId } from 'react'
import { shipClass } from '../lib/battleship'

const H = 40

interface Ink {
  hullTop: string; hullBot: string   // molded hull volume, lit -> shaded
  deckTop: string; deckBot: string   // flat deck / spine platform
  raiseTop: string; raiseBot: string // raised superstructure
  subTop: string; subBot: string     // submarine hull — sits lower, darker
  edge: string                       // molded part line
  hi: string                         // bevel catching the light
  ao: string                         // occlusion where raised parts meet deck
  dark: string                       // turrets, barrels, fins
  mark: string                       // deck markings
  peg: string                        // peg-hole hint
  accent: string                     // cyan rim / detail light
  shadow: string                     // contact shadow grounding the piece
}
const LIVE: Ink = {
  hullTop: '#c9ced4', hullBot: '#6d737b',
  deckTop: '#aeb4bb', deckBot: '#82888f',
  raiseTop: '#d8dce0', raiseBot: '#8d939b',
  subTop: '#8b9299', subBot: '#3f454d',
  edge: '#2e343c',
  hi: 'rgba(255,255,255,0.6)',
  ao: 'rgba(8,12,18,0.4)',
  dark: '#4a5058',
  mark: 'rgba(38,44,52,0.55)',
  peg: 'rgba(18,23,30,0.5)',
  accent: '#3df5ff',
  shadow: 'rgba(2,8,16,0.55)',
}
const SUNK: Ink = {
  hullTop: '#6b615e', hullBot: '#332c2a',
  deckTop: '#5a504d', deckBot: '#3d3532',
  raiseTop: '#6e6360', raiseBot: '#453c39',
  subTop: '#4e4543', subBot: '#241f1e',
  edge: '#191413',
  hi: 'rgba(255,255,255,0.14)',
  ao: 'rgba(0,0,0,0.5)',
  dark: '#2e2726',
  mark: 'rgba(0,0,0,0.35)',
  peg: 'rgba(0,0,0,0.35)',
  accent: 'rgba(255,190,170,0.3)',
  shadow: 'rgba(0,0,0,0.6)',
}

interface Art { W: number; ink: Ink; g: string }

// Soft contact shadow, offset toward bottom-right (light comes from top-left).
function Shadow({ W, ink, g, deep }: Art & { deep?: boolean }) {
  return (
    <ellipse cx={W / 2 + 1.5} cy="30.5" rx={W / 2 - 9} ry="3.4"
      fill={ink.shadow} opacity={deep ? 0.85 : 0.6} filter={`url(#${g}-b)`} />
  )
}

// Faint peg-hole hints on the piece, one per grid cell — the tabletop nod.
// Cell centers in SVG space: first at H/2, last at W - H/2.
function Pegs({ W, n, ink, dim }: { W: number; n: number; ink: Ink; dim?: boolean }) {
  const pitch = (W - H) / (n - 1)
  return (
    <g opacity={dim ? 0.3 : 0.45}>
      {Array.from({ length: n }, (_, i) => {
        const cx = H / 2 + i * pitch
        return (
          <g key={i}>
            <circle cx={cx} cy="20" r="1.8" fill={ink.peg} />
            <path d={`M ${cx - 1.8} 20 a 1.8 1.8 0 0 0 3.6 0`} fill="none"
              stroke={ink.hi} strokeWidth="0.5" opacity="0.6" />
          </g>
        )
      })}
    </g>
  )
}

// Round gun turret with twin barrels pointing toward the bow (+1) or stern (-1).
function Turret({ cx, r, toward, ink, g }: { cx: number; r: number; toward: 1 | -1; ink: Ink; g: string }) {
  const tip = cx + toward * (r + r * 2.6)
  return (
    <g>
      <circle cx={cx + 0.9} cy="20.9" r={r + 0.4} fill={ink.ao} />
      <line x1={cx + toward * (r - 1)} y1={20 - r * 0.42} x2={tip} y2={20 - r * 0.42}
        stroke={ink.dark} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={cx + toward * (r - 1)} y1={20 + r * 0.42} x2={tip} y2={20 + r * 0.42}
        stroke={ink.dark} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={cx} cy="20" r={r} fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.8" />
      <circle cx={cx - r * 0.18} cy={20 - r * 0.18} r={r * 0.5} fill={ink.raiseTop} opacity="0.9" />
    </g>
  )
}

function Carrier({ W, ink, g }: Art) {
  const x = (f: number) => W * f
  const deck = `M4 12 Q4 9.5 7 9.5 L${W - 24} 9.5 Q${W - 10} 12.5 ${W - 10} 20 Q${W - 10} 27.5 ${W - 24} 30.5 L7 30.5 Q4 30.5 4 28 Z`
  return (
    <g>
      <Shadow W={W} ink={ink} g={g} />
      {/* pointed hull peeking past the flight deck at the bow */}
      <path d={`M${W - 26} 13.5 Q${W - 5} 14.5 ${W - 3} 20 Q${W - 5} 25.5 ${W - 26} 26.5 Z`}
        fill={`url(#${g}-h)`} stroke={ink.edge} strokeWidth="0.8" />
      {/* flight deck */}
      <path d={deck} fill={`url(#${g}-d)`} stroke={ink.edge} strokeWidth="1.1" />
      <path d={deck} fill="none" stroke={ink.accent} strokeWidth="0.5" opacity="0.3" />
      {/* bevel: lit top edge, shaded bottom edge */}
      <path d={`M7 10.7 L${W - 25} 10.7`} stroke={ink.hi} strokeWidth="1" opacity="0.55" strokeLinecap="round" />
      <path d={`M7 29.3 L${W - 25} 29.3`} stroke={ink.ao} strokeWidth="1" opacity="0.7" strokeLinecap="round" />
      {/* runway centerline + faint angled-deck line */}
      <line x1="10" y1="15.5" x2={W - 18} y2="15.5" stroke={ink.mark} strokeWidth="1.4" strokeDasharray="5.5 4.5" opacity="0.8" />
      <line x1="11" y1="28" x2={x(0.6)} y2="13" stroke={ink.mark} strokeWidth="0.8" opacity="0.35" />
      <Pegs W={W} n={4} ink={ink} />
      {/* deck elevator */}
      <rect x={x(0.2)} y="10.8" width="8" height="4.2" rx="0.8" fill={ink.deckBot} stroke={ink.edge} strokeWidth="0.4" opacity="0.8" />
      {/* island superstructure, offset to starboard */}
      <rect x={x(0.56) + 1} y="22.6" width="14" height="7.4" rx="1.6" fill={ink.ao} />
      <rect x={x(0.56)} y="21.6" width="14" height="7.4" rx="1.6" fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.8" />
      <rect x={x(0.56) + 1.8} y="23" width="7" height="4.4" rx="1" fill={ink.raiseTop} />
      <circle cx={x(0.56) + 11.4} cy="25.3" r="2.2" fill={ink.accent} opacity="0.18" />
      <circle cx={x(0.56) + 11.4} cy="25.3" r="1" fill={ink.accent} opacity="0.9" />
    </g>
  )
}

function Cruiser({ W, ink, g }: Art) {
  const x = (f: number) => W * f
  const hull = `M4 20 Q4.5 12.5 15 11 L${x(0.6)} 11 Q${x(0.8)} 11.5 ${W - 3.5} 20 Q${x(0.8)} 28.5 ${x(0.6)} 29 L15 29 Q4.5 27.5 4 20 Z`
  return (
    <g>
      <Shadow W={W} ink={ink} g={g} />
      <path d={hull} fill={`url(#${g}-h)`} stroke={ink.edge} strokeWidth="1.1" />
      <path d={hull} fill="none" stroke={ink.accent} strokeWidth="0.5" opacity="0.3" />
      <path d={`M15 12.4 L${x(0.62)} 12.4`} stroke={ink.hi} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
      <path d={`M15 27.6 L${x(0.62)} 27.6`} stroke={ink.ao} strokeWidth="1" opacity="0.65" strokeLinecap="round" />
      {/* raised centerline spine, tapering toward the bow */}
      <path
        d={`M${x(0.1)} 20 Q${x(0.1)} 15.4 ${x(0.16)} 15.2 L${x(0.72)} 15.2 L${x(0.82)} 20 L${x(0.72)} 24.8 L${x(0.16)} 24.8 Q${x(0.1)} 24.6 ${x(0.1)} 20 Z`}
        fill={`url(#${g}-d)`} stroke={ink.edge} strokeWidth="0.6" strokeOpacity="0.55" opacity="0.95"
      />
      <Pegs W={W} n={3} ink={ink} />
      {/* fore + aft twin-barrel turrets */}
      <Turret cx={W - 28} r={4.2} toward={1} ink={ink} g={g} />
      <Turret cx={25} r={4.2} toward={-1} ink={ink} g={g} />
      {/* central bridge tower */}
      <rect x={W / 2 - 8} y="15.5" width="18" height="10.5" rx="2" fill={ink.ao} />
      <rect x={W / 2 - 9} y="14.5" width="18" height="10.5" rx="2" fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.8" />
      <rect x={W / 2 - 5.5} y="16.5" width="11" height="6.5" rx="1.2" fill={ink.raiseTop} />
      <circle cx={W / 2} cy="20" r="1.8" fill={ink.accent} opacity="0.18" />
      <circle cx={W / 2} cy="20" r="0.9" fill={ink.accent} opacity="0.9" />
    </g>
  )
}

function Submarine({ W, ink, g }: Art) {
  const x = (f: number) => W * f
  const hull = `M${W - 4} 20 Q${W - 4} 13.5 ${x(0.7)} 12.5 L${x(0.2)} 14 Q6 15.5 6 20 Q6 24.5 ${x(0.2)} 26 L${x(0.7)} 27.5 Q${W - 4} 26.5 ${W - 4} 20 Z`
  return (
    <g>
      <Shadow W={W} ink={ink} g={g} deep />
      {/* stern fins */}
      <path d="M9 16.5 l-5.5 -4 l1 4.8 Z" fill={ink.dark} stroke={ink.edge} strokeWidth="0.5" />
      <path d="M9 23.5 l-5.5 4 l1 -4.8 Z" fill={ink.dark} stroke={ink.edge} strokeWidth="0.5" />
      {/* bow dive planes */}
      <path d={`M${x(0.78)} 13.4 l4.5 -2.8 l1.4 2.2 Z`} fill={ink.dark} stroke={ink.edge} strokeWidth="0.5" />
      <path d={`M${x(0.78)} 26.6 l4.5 2.8 l1.4 -2.2 Z`} fill={ink.dark} stroke={ink.edge} strokeWidth="0.5" />
      {/* rounded teardrop hull — darker, riding lower than the surface ships */}
      <path d={hull} fill={`url(#${g}-s)`} stroke={ink.edge} strokeWidth="1.1" />
      <path d={hull} fill="none" stroke={ink.accent} strokeWidth="0.5" opacity="0.22" />
      <path d={`M${x(0.22)} 15.2 Q${x(0.45)} 13.8 ${x(0.68)} 13.9`} fill="none" stroke={ink.hi} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
      {/* anti-slip deck strip */}
      <rect x={x(0.16)} y="17.8" width={x(0.58)} height="4.4" rx="2.2" fill={ink.mark} opacity="0.45" />
      <Pegs W={W} n={3} ink={ink} dim />
      {/* sail (conning tower) + periscope light */}
      <ellipse cx={W / 2 + 0.8} cy="20.8" rx="7.6" ry="5.6" fill={ink.ao} />
      <rect x={W / 2 - 7} y="14.8" width="14" height="10.4" rx="4" fill={`url(#${g}-d)`} stroke={ink.edge} strokeWidth="0.8" />
      <rect x={W / 2 - 4.5} y="16.6" width="9" height="4.4" rx="2" fill={ink.deckTop} opacity="0.85" />
      <circle cx={W / 2 + 3.5} cy="17.6" r="1.9" fill={ink.accent} opacity="0.18" />
      <circle cx={W / 2 + 3.5} cy="17.6" r="0.9" fill={ink.accent} opacity="0.9" />
    </g>
  )
}

function Destroyer({ W, ink, g }: Art) {
  const x = (f: number) => W * f
  const hull = `M4 20 Q4.5 13.8 13 12.5 L${x(0.52)} 12.5 L${W - 3.5} 20 L${x(0.52)} 27.5 L13 27.5 Q4.5 26.2 4 20 Z`
  return (
    <g>
      <Shadow W={W} ink={ink} g={g} />
      <path d={hull} fill={`url(#${g}-h)`} stroke={ink.edge} strokeWidth="1.1" />
      <path d={hull} fill="none" stroke={ink.accent} strokeWidth="0.5" opacity="0.3" />
      <path d={`M13 13.8 L${x(0.54)} 13.8`} stroke={ink.hi} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
      <path d={`M13 26.2 L${x(0.54)} 26.2`} stroke={ink.ao} strokeWidth="1" opacity="0.65" strokeLinecap="round" />
      {/* raised spine, raked with the bow */}
      <path
        d={`M${x(0.12)} 20 Q${x(0.12)} 15.9 ${x(0.19)} 15.7 L${x(0.5)} 15.7 L${x(0.6)} 20 L${x(0.5)} 24.3 L${x(0.19)} 24.3 Q${x(0.12)} 24.1 ${x(0.12)} 20 Z`}
        fill={`url(#${g}-d)`} stroke={ink.edge} strokeWidth="0.6" strokeOpacity="0.55" opacity="0.95"
      />
      <Pegs W={W} n={2} ink={ink} />
      {/* forward turret */}
      <Turret cx={W - 26} r={3.2} toward={1} ink={ink} g={g} />
      {/* compact bridge, just aft of center */}
      <rect x={x(0.24) + 1} y="16.3" width={x(0.22)} height="9.4" rx="1.8" fill={ink.ao} />
      <rect x={x(0.24)} y="15.3" width={x(0.22)} height="9.4" rx="1.8" fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.7" />
      <rect x={x(0.27)} y="17" width={x(0.14)} height="5.6" rx="1" fill={ink.raiseTop} />
      <circle cx={x(0.35)} cy="20" r="1.6" fill={ink.accent} opacity="0.18" />
      <circle cx={x(0.35)} cy="20" r="0.8" fill={ink.accent} opacity="0.9" />
    </g>
  )
}

function Patrol({ W, ink, g }: Art) {
  const x = (f: number) => W * f
  const hull = `M5 20 Q5 14.2 16 13.2 L${x(0.55)} 13.2 Q${W - 5} 14.5 ${W - 4} 20 Q${W - 5} 25.5 ${x(0.55)} 26.8 L16 26.8 Q5 25.8 5 20 Z`
  return (
    <g>
      <Shadow W={W} ink={ink} g={g} />
      <path d={hull} fill={`url(#${g}-h)`} stroke={ink.edge} strokeWidth="1.1" />
      <path d={hull} fill="none" stroke={ink.accent} strokeWidth="0.5" opacity="0.3" />
      <path d={`M16 14.5 L${x(0.56)} 14.5`} stroke={ink.hi} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
      <path d={`M16 25.5 L${x(0.56)} 25.5`} stroke={ink.ao} strokeWidth="1" opacity="0.65" strokeLinecap="round" />
      {/* aft working deck */}
      <rect x="11" y="16.6" width={x(0.18)} height="6.8" rx="1.2" fill={ink.mark} opacity="0.35" />
      <Pegs W={W} n={2} ink={ink} />
      {/* little cabin with windshield facing the bow */}
      <rect x={x(0.32) + 1} y="16.3" width={x(0.3)} height="9.4" rx="2.4" fill={ink.ao} />
      <rect x={x(0.32)} y="15.3" width={x(0.3)} height="9.4" rx="2.4" fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.7" />
      <rect x={x(0.35)} y="17" width={x(0.18)} height="5.6" rx="1.2" fill={ink.raiseTop} />
      <rect x={x(0.32) + x(0.3) - 2.6} y="16.8" width="1.7" height="6.4" rx="0.85" fill={ink.accent} opacity="0.45" />
      {/* fore deck gun */}
      <line x1={x(0.74)} y1="20" x2={x(0.74) + 8} y2="20" stroke={ink.dark} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx={x(0.74)} cy="20" r="2.5" fill={`url(#${g}-r)`} stroke={ink.edge} strokeWidth="0.7" />
    </g>
  )
}

// Scorched fissures + soot for the sunk variant.
function Wreck({ W }: { W: number }) {
  return (
    <g>
      <ellipse cx={W * 0.35} cy="19" rx="4.5" ry="3" fill="rgba(0,0,0,0.45)" />
      <ellipse cx={W * 0.66} cy="21" rx="3.8" ry="2.6" fill="rgba(0,0,0,0.4)" />
      <path d={`M${W * 0.3} 13 L${W * 0.34} 17 L${W * 0.31} 21 L${W * 0.37} 24 L${W * 0.34} 27`} stroke="#ff7a54" strokeWidth="1.1" fill="none" opacity="0.7" strokeLinejoin="round" />
      <path d={`M${W * 0.68} 26 L${W * 0.64} 22 L${W * 0.67} 18.5 L${W * 0.62} 16 L${W * 0.65} 13`} stroke="#ff7a54" strokeWidth="1.1" fill="none" opacity="0.7" strokeLinejoin="round" />
    </g>
  )
}

export default function Warship({ shipId, aspect, horiz, sunk }: {
  shipId: string; aspect: number; horiz: boolean; sunk: boolean
}) {
  const gid = useId()
  const W = Math.round(aspect * H)
  const cls = shipClass(shipId)
  const ink = sunk ? SUNK : LIVE
  const art = (
    <>
      <defs>
        <linearGradient id={`${gid}-h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.hullTop} /><stop offset="1" stopColor={ink.hullBot} />
        </linearGradient>
        <linearGradient id={`${gid}-d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.deckTop} /><stop offset="1" stopColor={ink.deckBot} />
        </linearGradient>
        <linearGradient id={`${gid}-r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.raiseTop} /><stop offset="1" stopColor={ink.raiseBot} />
        </linearGradient>
        <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.subTop} /><stop offset="1" stopColor={ink.subBot} />
        </linearGradient>
        <filter id={`${gid}-b`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {cls === 'carrier' ? <Carrier W={W} ink={ink} g={gid} />
        : cls === 'cruiser' ? <Cruiser W={W} ink={ink} g={gid} />
        : cls === 'submarine' ? <Submarine W={W} ink={ink} g={gid} />
        : cls === 'destroyer' ? <Destroyer W={W} ink={ink} g={gid} />
        : <Patrol W={W} ink={ink} g={gid} />}
      {sunk && <Wreck W={W} />}
    </>
  )
  return horiz ? (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" aria-hidden="true">{art}</svg>
  ) : (
    <svg viewBox={`0 0 ${H} ${W}`} className="w-full h-full" aria-hidden="true">
      {/* exact 90° rotation in SVG space: bow points up, footprint stays N cells tall */}
      <g transform={`rotate(-90) translate(${-W} 0)`}>{art}</g>
    </svg>
  )
}
