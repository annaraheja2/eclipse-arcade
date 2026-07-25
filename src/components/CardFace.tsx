// Pure presentational card faces for 2D surfaces (the drawn-card panel). No
// game logic lives here — they render a `Card` (from the engine's data) and
// nothing more; the 3D table bakes its own richer canvas version of the same
// ECLIPSE design (CardTable3D.tsx) and the two must stay on one palette.
//
// Accessibility: color is NEVER the only signal. Every face shows its glyph
// (number or action tag) AND a text label naming the suit, and static faces
// carry a full aria-label. Ink colors are tuned per stock for WCAG AA.

import type { Card, Color } from '../lib/cardgame'
import { cardGlyph, describeCard, colorName } from '../lib/cardgameView'

// The ECLIPSE suits (mirrors SUIT in CardTable3D): stock + ink + gold linework.
// Engine keys stay UNO's; presentation remaps red→Ember, yellow→Solar,
// green→Forest, blue→Lunar.
const SKIN: Record<Color, { fill: string; gold: string; ink: string }> = {
  red: { fill: '#8a2f26', gold: '#dcb46a', ink: '#f2e4c4' },
  yellow: { fill: '#eadfc0', gold: '#96742f', ink: '#26190e' },
  green: { fill: '#3d5234', gold: '#c9a35c', ink: '#f0e6c8' },
  blue: { fill: '#1e2c46', gold: '#c9a35c', ink: '#f0e4c4' },
}
const WILD_SKIN = { fill: '#181328', gold: '#c9a35c', ink: '#f0e4c4' }

// The wild diamond, quartered N/E/S/W: solar, lunar, ember, forest.
const WILD_QUADRANTS: { color: string; d: string }[] = [
  { color: '#e9dcba', d: 'M25 3 L47 25 L25 25 Z' },
  { color: '#3c5c94', d: 'M47 25 L25 47 L25 25 Z' },
  { color: '#b8412f', d: 'M25 47 L3 25 L25 25 Z' },
  { color: '#4e7a48', d: 'M3 25 L25 3 L25 25 Z' },
]

const SERIF = '"Playfair Display", Georgia, serif'

export type CardSize = 'sm' | 'md' | 'lg'
const DIMS: Record<CardSize, { w: number; h: number; glyph: number; corner: number; label: number }> = {
  sm: { w: 34, h: 50, glyph: 17, corner: 9, label: 6 },
  md: { w: 52, h: 76, glyph: 27, corner: 12, label: 8 },
  lg: { w: 64, h: 94, glyph: 34, corner: 14, label: 9 },
}

/** The visual only — no semantics. Wrap in a button (aria-label) for interaction. */
export function CardFace({ card, size = 'lg' }: { card: Card; size?: CardSize }) {
  const d = DIMS[size]
  const glyph = cardGlyph(card)
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  const skin = card.color ? SKIN[card.color] : WILD_SKIN
  const label = isWild ? (card.kind === 'wild4' ? 'WILD +4' : 'WILD') : `${colorName(card.color!).toUpperCase()}`

  return (
    <span
      className="relative inline-grid place-items-center rounded-lg select-none"
      style={{ width: d.w, height: d.h, background: skin.fill, boxShadow: `inset 0 0 0 1px ${skin.gold}, inset 0 0 0 3px ${skin.fill}, 0 4px 10px -4px rgba(0,0,0,0.7)` }}
    >
      {isWild && (
        <svg aria-hidden viewBox="0 0 50 50" className="absolute" style={{ width: d.w * 0.72, height: d.w * 0.72, top: '22%' }}>
          {WILD_QUADRANTS.map((q) => <path key={q.color} d={q.d} fill={q.color} stroke={skin.gold} strokeWidth="1.5" strokeLinejoin="round" />)}
        </svg>
      )}
      {!isWild && card.kind !== 'skip' && card.kind !== 'reverse' && (
        <>
          <span aria-hidden className="absolute top-0.5 left-1 leading-none" style={{ fontFamily: SERIF, fontWeight: 600, fontSize: d.corner, color: skin.ink }}>{glyph}</span>
          <span aria-hidden className="absolute bottom-0.5 right-1 leading-none rotate-180" style={{ fontFamily: SERIF, fontWeight: 600, fontSize: d.corner, color: skin.ink }}>{glyph}</span>
        </>
      )}
      {!isWild && (card.kind === 'skip' || card.kind === 'reverse' ? (
        <svg aria-hidden viewBox="0 0 24 24" className="relative -mt-1" style={{ width: d.glyph, height: d.glyph }} fill="none" stroke={skin.ink} strokeWidth="2.4" strokeLinecap="round">
          {card.kind === 'skip'
            ? <><circle cx="12" cy="12" r="8.5" /><path d="M6 18 L18 6" /></>
            : <><path d="M18.5 9a7 7 0 0 0 -11.6 -1.6" /><path d="M7.3 3.6 L6.9 7.6 L10.9 7.5" fill={skin.ink} stroke="none" /><path d="M5.5 15a7 7 0 0 0 11.6 1.6" /><path d="M16.7 20.4 L17.1 16.4 L13.1 16.5" fill={skin.ink} stroke="none" /></>}
        </svg>
      ) : (
        <span className="relative leading-none -mt-1" style={{ fontFamily: SERIF, fontWeight: 600, fontSize: isWild ? 0 : d.glyph, color: skin.ink }}>
          {isWild ? '' : glyph}
        </span>
      ))}
      {/* suit/kind name — the non-color signal, suit ink on the stock (AA) */}
      <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 font-sans font-bold tracking-wider whitespace-nowrap"
        style={{ fontSize: d.label, color: skin.ink }}>
        {label}
      </span>
    </span>
  )
}

/** A static, labelled card (e.g. the discard top) — announced to assistive tech. */
export function StaticCard({ card, size = 'lg', chosenColor }: { card: Card; size?: CardSize; chosenColor?: Color | null }) {
  return (
    <span role="img" aria-label={describeCard(card, chosenColor)}>
      <CardFace card={card} size={size} />
    </span>
  )
}

/** A face-down card back — the ECLIPSE crescent on navy, purely decorative. */
export function CardBack({ size = 'sm' }: { size?: CardSize }) {
  const d = DIMS[size]
  return (
    <span aria-hidden className="relative inline-grid place-items-center rounded-lg"
      style={{ width: d.w, height: d.h, background: 'linear-gradient(180deg,#182338,#0d1424)', boxShadow: 'inset 0 0 0 1px #c9a35c, inset 0 0 0 3px #0d1424, 0 3px 8px -3px rgba(0,0,0,0.8)' }}>
      <svg viewBox="0 0 24 24" style={{ width: d.w * 0.55, height: d.w * 0.55 }} fill="none">
        <circle cx="12" cy="12" r="7.5" fill="#c9a35c" />
        <circle cx="15" cy="10" r="6.8" fill="#111a2c" />
      </svg>
    </span>
  )
}
