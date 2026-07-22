// Top-down warship art. Five distinct silhouettes (carrier / cruiser / submarine /
// destroyer / patrol) keyed off the ship id. Art is authored horizontally with the
// bow to the right in a viewBox that matches the ship's true N-cell footprint, and
// vertical ships rotate the whole drawing in SVG space (bow up) — so a length-N
// ship always fills exactly N cells with undistorted art.
import { useId } from 'react'
import { shipClass } from '../lib/battleship'

const H = 40

interface Ink {
  top: string; bot: string; line: string
  feat: string; featDark: string
  deckTop: string; deckBot: string
  subTop: string; subBot: string
  detail: string; accent: string
}
const LIVE: Ink = {
  top: '#a9b9c9', bot: '#5f6e7d', line: '#141e28',
  feat: '#7e8fa1', featDark: '#42505e',
  deckTop: '#5a6773', deckBot: '#3a444e',
  subTop: '#47596d', subBot: '#1f2e3d',
  detail: '#d7e7f4', accent: '#3df5ff',
}
const SUNK: Ink = {
  top: '#5a4646', bot: '#2c1f1f', line: '#120c0c',
  feat: '#5d4646', featDark: '#382a2a',
  deckTop: '#443535', deckBot: '#291f1f',
  subTop: '#463636', subBot: '#211818',
  detail: '#7a6060', accent: 'rgba(255,255,255,0.18)',
}

function Carrier({ W, ink, g }: { W: number; ink: Ink; g: string }) {
  const x = (f: number) => Math.round(W * f)
  return (
    <g>
      {/* hull peeking beneath the flight deck */}
      <path d={`M5 12 L${W - 10} 12 Q ${W - 4} 20 ${W - 10} 28 L5 28 Z`} fill={ink.bot} />
      {/* flight deck */}
      <path
        d={`M2 13 Q2 11 4 11 L${W - 16} 10 Q ${W - 3} 13 ${W - 3} 20 Q ${W - 3} 27 ${W - 16} 30 L4 29 Q2 29 2 27 Z`}
        fill={`url(#${g}-d)`} stroke={ink.line} strokeWidth="1"
      />
      {/* runway centerline + angled deck */}
      <line x1="9" y1="20" x2={W - 20} y2="20" stroke={ink.detail} strokeWidth="1.6" strokeDasharray="6 5" opacity="0.5" />
      <line x1="10" y1="27" x2={x(0.55)} y2="13" stroke={ink.detail} strokeWidth="0.8" opacity="0.18" />
      {/* elevators */}
      <rect x={x(0.24)} y="12.3" width="7.5" height="4.6" rx="0.8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" strokeWidth="0.5" />
      <rect x={x(0.36)} y="23.1" width="7.5" height="4.6" rx="0.8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" strokeWidth="0.5" />
      {/* island superstructure */}
      <rect x={x(0.6)} y="11.5" width="12" height="7.5" rx="1.5" fill={ink.feat} stroke={ink.line} strokeWidth="0.8" />
      <rect x={x(0.6) + 2} y="13" width="5" height="4.5" rx="1" fill={ink.top} />
      <circle cx={x(0.6) + 9.5} cy="15.2" r="1.1" fill={ink.accent} />
      {/* deck-edge running light */}
      <line x1="7" y1="11.7" x2={W - 18} y2="10.8" stroke={ink.accent} strokeWidth="0.7" opacity="0.35" />
    </g>
  )
}

function Cruiser({ W, ink, g }: { W: number; ink: Ink; g: string }) {
  const x = (f: number) => Math.round(W * f)
  return (
    <g>
      {/* hull — pointed bow, rounded stern */}
      <path
        d={`M2.5 20 Q3 12 16 10.5 L${x(0.62)} 10.5 L${W - 2.5} 20 L${x(0.62)} 29.5 L16 29.5 Q3 28 2.5 20 Z`}
        fill={`url(#${g}-h)`} stroke={ink.line} strokeWidth="1"
      />
      {/* deck inset */}
      <path
        d={`M9 20 Q9 14.5 18 13.5 L${x(0.6)} 13.5 L${W - 9} 20 L${x(0.6)} 26.5 L18 26.5 Q9 25.5 9 20 Z`}
        fill="rgba(12,22,32,0.22)"
      />
      {/* superstructure */}
      <rect x={x(0.34)} y="14.5" width={x(0.19)} height="11" rx="1.5" fill={ink.feat} stroke={ink.line} strokeWidth="0.7" />
      <rect x={x(0.38)} y="17" width={x(0.1)} height="6" rx="1" fill={ink.top} />
      {/* fore turret — barrels toward the bow */}
      <line x1={x(0.71) + 2.5} y1="18.4" x2={x(0.71) + 9.5} y2="18.4" stroke={ink.line} strokeWidth="1.1" />
      <line x1={x(0.71) + 2.5} y1="21.6" x2={x(0.71) + 9.5} y2="21.6" stroke={ink.line} strokeWidth="1.1" />
      <circle cx={x(0.71)} cy="20" r="3.6" fill={ink.featDark} stroke={ink.line} strokeWidth="0.7" />
      {/* aft turret — barrels toward the stern */}
      <line x1={x(0.2) - 2.5} y1="18.4" x2={x(0.2) - 9.5} y2="18.4" stroke={ink.line} strokeWidth="1.1" />
      <line x1={x(0.2) - 2.5} y1="21.6" x2={x(0.2) - 9.5} y2="21.6" stroke={ink.line} strokeWidth="1.1" />
      <circle cx={x(0.2)} cy="20" r="3.6" fill={ink.featDark} stroke={ink.line} strokeWidth="0.7" />
      {/* deck-edge light */}
      <line x1="18" y1="11.6" x2={x(0.6)} y2="11.6" stroke={ink.accent} strokeWidth="0.7" opacity="0.3" />
    </g>
  )
}

function Submarine({ W, ink, g }: { W: number; ink: Ink; g: string }) {
  const x = (f: number) => Math.round(W * f)
  return (
    <g>
      {/* teardrop hull — rounded bow, tapered stern */}
      <path
        d={`M${W - 3} 20 Q ${W - 3} 13 ${x(0.72)} 12 L${x(0.2)} 13.5 Q 3.5 15 3.5 20 Q 3.5 25 ${x(0.2)} 26.5 L${x(0.72)} 28 Q ${W - 3} 27 ${W - 3} 20 Z`}
        fill={`url(#${g}-s)`} stroke={ink.line} strokeWidth="1"
      />
      {/* spine */}
      <line x1="10" y1="20" x2={W - 8} y2="20" stroke="rgba(150,195,230,0.28)" strokeWidth="1" />
      {/* stern fins */}
      <path d={`M7 16.5 l-4.5 -3.5 l0.6 4.4 Z`} fill={ink.featDark} />
      <path d={`M7 23.5 l-4.5 3.5 l0.6 -4.4 Z`} fill={ink.featDark} />
      {/* bow dive planes */}
      <path d={`M${x(0.8)} 13 l4 -2.6 l1.6 2 Z`} fill={ink.featDark} />
      <path d={`M${x(0.8)} 27 l4 2.6 l1.6 -2 Z`} fill={ink.featDark} />
      {/* sail (conning tower) */}
      <rect x={x(0.44)} y="14.8" width={x(0.15)} height="10.4" rx="3" fill={ink.subBot} stroke={ink.line} strokeWidth="0.8" />
      <circle cx={x(0.44) + x(0.15) - 3} cy="17.6" r="1.2" fill={ink.accent} />
    </g>
  )
}

function Destroyer({ W, ink, g }: { W: number; ink: Ink; g: string }) {
  const x = (f: number) => Math.round(W * f)
  return (
    <g>
      {/* sleek hull, long raked bow */}
      <path
        d={`M2.5 20 Q3 13.5 12 12 L${x(0.52)} 12 L${W - 2.5} 20 L${x(0.52)} 28 L12 28 Q3 26.5 2.5 20 Z`}
        fill={`url(#${g}-h)`} stroke={ink.line} strokeWidth="1"
      />
      {/* deck inset */}
      <path
        d={`M8 20 Q8 15.5 14 14.8 L${x(0.5)} 14.8 L${W - 8} 20 L${x(0.5)} 25.2 L14 25.2 Q8 24.5 8 20 Z`}
        fill="rgba(12,22,32,0.2)"
      />
      {/* angular bridge */}
      <path d={`M${x(0.26)} 15 L${x(0.46)} 15 L${x(0.5)} 20 L${x(0.46)} 25 L${x(0.26)} 25 Z`} fill={ink.feat} stroke={ink.line} strokeWidth="0.7" />
      <rect x={x(0.3)} y="17.5" width={x(0.1)} height="5" rx="1" fill={ink.top} />
      {/* fore gun */}
      <line x1={x(0.63) + 2} y1="19" x2={x(0.63) + 8.5} y2="19" stroke={ink.line} strokeWidth="1" />
      <line x1={x(0.63) + 2} y1="21" x2={x(0.63) + 8.5} y2="21" stroke={ink.line} strokeWidth="1" />
      <circle cx={x(0.63)} cy="20" r="3" fill={ink.featDark} stroke={ink.line} strokeWidth="0.7" />
      {/* deck-edge light */}
      <line x1="12" y1="13" x2={x(0.5)} y2="13" stroke={ink.accent} strokeWidth="0.7" opacity="0.3" />
    </g>
  )
}

function Patrol({ W, ink }: { W: number; ink: Ink }) {
  const x = (f: number) => Math.round(W * f)
  return (
    <g>
      {/* tubby gunboat hull — rounded bow */}
      <path
        d={`M3.5 20 Q4 14.8 15 14 L${x(0.62)} 14 Q ${W - 4} 15.5 ${W - 3} 20 Q ${W - 4} 24.5 ${x(0.62)} 26 L15 26 Q4 25.2 3.5 20 Z`}
        fill={ink.top} stroke={ink.line} strokeWidth="1"
      />
      <path
        d={`M3.5 20 Q4 22.8 10 24.2 L${x(0.62)} 25 Q ${W - 4} 24 ${W - 3} 20 L3.5 20 Z`}
        fill={ink.bot} opacity="0.85"
      />
      {/* aft working deck */}
      <rect x="10" y="16.5" width={x(0.18)} height="7" rx="1.2" fill="rgba(12,22,32,0.2)" />
      {/* cabin with windshield */}
      <rect x={x(0.34)} y="15.8" width={x(0.24)} height="8.4" rx="2" fill={ink.feat} stroke={ink.line} strokeWidth="0.7" />
      <rect x={x(0.34) + x(0.24) - 2.4} y="16.8" width="1.6" height="6.4" rx="0.8" fill={ink.accent} opacity="0.55" />
      {/* fore deck gun */}
      <line x1={x(0.72) + 1.5} y1="20" x2={x(0.72) + 7} y2="20" stroke={ink.line} strokeWidth="1" />
      <circle cx={x(0.72)} cy="20" r="2.4" fill={ink.featDark} stroke={ink.line} strokeWidth="0.7" />
    </g>
  )
}

function Cracks({ W }: { W: number }) {
  return (
    <g>
      <line x1={W * 0.3} y1="13" x2={W * 0.42} y2="27" stroke="#ff5a5a" strokeWidth="1.3" opacity="0.75" />
      <line x1={W * 0.68} y1="26" x2={W * 0.6} y2="13" stroke="#ff5a5a" strokeWidth="1.3" opacity="0.75" />
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
          <stop offset="0" stopColor={ink.top} /><stop offset="1" stopColor={ink.bot} />
        </linearGradient>
        <linearGradient id={`${gid}-d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.deckTop} /><stop offset="1" stopColor={ink.deckBot} />
        </linearGradient>
        <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.subTop} /><stop offset="1" stopColor={ink.subBot} />
        </linearGradient>
      </defs>
      {cls === 'carrier' ? <Carrier W={W} ink={ink} g={gid} />
        : cls === 'cruiser' ? <Cruiser W={W} ink={ink} g={gid} />
        : cls === 'submarine' ? <Submarine W={W} ink={ink} g={gid} />
        : cls === 'destroyer' ? <Destroyer W={W} ink={ink} g={gid} />
        : <Patrol W={W} ink={ink} />}
      {sunk && <Cracks W={W} />}
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
