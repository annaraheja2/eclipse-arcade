// Pure presentational card faces for the 2D table. No game logic lives here —
// they render a `Card` (from the engine's data) and nothing more, so the coming
// 3D table can replace this file wholesale without touching the flow hook.
//
// Accessibility: color is NEVER the only signal. Every face shows its glyph
// (number or action tag) AND a text label naming the color, and static faces
// carry a full aria-label. Text sits on high-contrast fills / dark pills so it
// clears WCAG AA on the neon-dark field.

import type { Card, Color } from '../lib/cardgame'
import { cardGlyph, describeCard, colorName } from '../lib/cardgameView'

// Fill + on-fill text tuned for contrast. Yellow takes near-black ink; the rest
// take white. The color-name pill is always white-on-dark, so it's legible
// regardless of the fill behind it.
const SKIN: Record<Color, { fill: string; edge: string; ink: string }> = {
  red: { fill: '#c62828', edge: '#7f1414', ink: '#ffffff' },
  yellow: { fill: '#e0a200', edge: '#906500', ink: '#1a1400' },
  green: { fill: '#1f9d4d', edge: '#0f5e2c', ink: '#ffffff' },
  blue: { fill: '#2f6fd8', edge: '#123f8c', ink: '#ffffff' },
}

const WILD_QUADRANTS: { color: string; d: string }[] = [
  { color: '#c62828', d: 'M6 6 h18 v18 h-18 z' },
  { color: '#e0a200', d: 'M26 6 h18 v18 h-18 z' },
  { color: '#1f9d4d', d: 'M6 26 h18 v18 h-18 z' },
  { color: '#2f6fd8', d: 'M26 26 h18 v18 h-18 z' },
]

export type CardSize = 'sm' | 'md' | 'lg'
const DIMS: Record<CardSize, { w: number; h: number; glyph: number; corner: number; label: number }> = {
  sm: { w: 34, h: 50, glyph: 15, corner: 8, label: 6 },
  md: { w: 52, h: 76, glyph: 24, corner: 11, label: 8 },
  lg: { w: 64, h: 94, glyph: 30, corner: 13, label: 9 },
}

/** The visual only — no semantics. Wrap in a button (aria-label) for interaction. */
export function CardFace({ card, size = 'lg' }: { card: Card; size?: CardSize }) {
  const d = DIMS[size]
  const glyph = cardGlyph(card)
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  const skin = card.color ? SKIN[card.color] : null
  const ink = skin ? skin.ink : '#ffffff'
  const fill = skin ? skin.fill : '#171033'
  const edge = skin ? skin.edge : '#000000'
  const label = isWild ? (card.kind === 'wild4' ? 'WILD +4' : 'WILD') : `${colorName(card.color!).toUpperCase()}`

  return (
    <span
      className="relative inline-grid place-items-center rounded-lg select-none"
      style={{ width: d.w, height: d.h, background: fill, boxShadow: `inset 0 0 0 2px ${edge}, 0 4px 10px -4px rgba(0,0,0,0.7)` }}
    >
      {/* the classic slanted inner oval */}
      <span aria-hidden className="absolute inset-[3px] rounded-md" style={{ background: 'rgba(255,255,255,0.14)', transform: 'skewX(-14deg) scale(0.86)' }} />
      {isWild && (
        <svg aria-hidden viewBox="0 0 50 50" className="absolute" style={{ width: d.w * 0.7, height: d.w * 0.7 }}>
          {WILD_QUADRANTS.map((q) => <path key={q.color} d={q.d} fill={q.color} rx={4} />)}
        </svg>
      )}
      {!isWild && (
        <>
          <span aria-hidden className="absolute top-0.5 left-1 font-pixel leading-none" style={{ fontSize: d.corner, color: ink }}>{glyph}</span>
          <span aria-hidden className="absolute bottom-0.5 right-1 font-pixel leading-none rotate-180" style={{ fontSize: d.corner, color: ink }}>{glyph}</span>
        </>
      )}
      <span className="relative font-pixel leading-none" style={{ fontSize: isWild ? d.glyph * 0.5 : d.glyph, color: ink, textShadow: isWild ? '0 1px 3px rgba(0,0,0,0.9)' : 'none' }}>
        {isWild ? '' : glyph}
      </span>
      {/* color/kind name — the non-color signal, white on a dark pill for AA */}
      <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 font-pixel tracking-wide rounded px-1 py-[1px] whitespace-nowrap"
        style={{ fontSize: d.label, background: 'rgba(0,0,0,0.55)', color: '#ffffff' }}>
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

/** A face-down card back — the Eclipse crescent motif, purely decorative. */
export function CardBack({ size = 'sm' }: { size?: CardSize }) {
  const d = DIMS[size]
  return (
    <span aria-hidden className="relative inline-grid place-items-center rounded-lg"
      style={{ width: d.w, height: d.h, background: 'linear-gradient(160deg,#2a1a55,#150c30)', boxShadow: 'inset 0 0 0 2px #3a2470, 0 3px 8px -3px rgba(0,0,0,0.8)' }}>
      <svg viewBox="0 0 24 24" style={{ width: d.w * 0.5, height: d.w * 0.5 }} fill="none">
        <circle cx="12" cy="12" r="7" fill="#7c3aff" opacity="0.55" />
        <circle cx="15" cy="10" r="6" fill="#150c30" />
      </svg>
    </span>
  )
}
