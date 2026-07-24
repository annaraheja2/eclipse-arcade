// The 2D card table — the SWAPPABLE presentation layer. It renders a view model
// from useCardGame and calls back when the human activates a card; it holds no
// rules and no interaction state. The next stage drops a 3D table in this slot
// with the same props, and the flow hook never changes.

import type { Card, Color } from '../lib/cardgame'
import { colorName } from '../lib/cardgameView'
import { CardFace, StaticCard, CardBack } from './CardFace'
import type { CardGameView } from '../hooks/useCardGame'
import { Rotate } from '../icons'

const SWATCH: Record<Color, string> = { red: '#c62828', yellow: '#e0a200', green: '#1f9d4d', blue: '#2f6fd8' }

export default function CardTable({ view, accent, onCardActivate }: {
  view: CardGameView
  accent: string
  onCardActivate: (card: Card) => void
}) {
  const { seats, top, currentColor, hand, legal, stackable, phase, yourTurn } = view
  // Which hand cards are actionable right now, and via which prompt.
  const actionable = phase === 'choose' ? legal : phase === 'penalty' ? stackable : []
  const actionableIds = new Set(actionable.map((c) => c.id))
  const handInteractive = phase === 'choose' || phase === 'penalty'

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
      {/* opponents */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
        {seats.map((s) => (
          <div key={s.name}
            className={`rounded-xl border p-2.5 text-center transition ${s.current ? 'bg-white/[0.06]' : 'bg-white/[0.02]'}`}
            style={{ borderColor: s.current ? accent : 'rgba(255,255,255,0.10)', boxShadow: s.current ? `0 0 16px -4px ${accent}` : 'none' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1.5" aria-hidden>
              <CardBack size="sm" />
              {s.count > 1 && <span className="font-pixel text-[9px] text-white/70">×{s.count}</span>}
            </div>
            <div className="font-pixel text-[9px] tracking-wide truncate" style={{ color: s.current ? accent : '#ffffffcc' }}>{s.name}</div>
            <div className="text-[11px] text-white/60 mt-0.5">
              {s.count} card{s.count === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>

      {/* discard + active color + turn / direction */}
      <div className="flex items-center justify-center gap-5 sm:gap-8 py-3">
        <div className="text-center">
          <div className="font-pixel text-[8px] tracking-wider text-white/50 mb-2">DISCARD</div>
          {top ? <StaticCard card={top} size="lg" chosenColor={currentColor} /> : <CardBack size="lg" />}
        </div>
        <div className="flex flex-col items-center gap-2">
          {currentColor && (
            <div className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5">
              <span aria-hidden className="w-3.5 h-3.5 rounded-sm" style={{ background: SWATCH[currentColor], boxShadow: `0 0 8px ${SWATCH[currentColor]}` }} />
              <span className="font-pixel text-[9px] tracking-wide text-white/90">{colorName(currentColor).toUpperCase()}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-white/60" title={`Play direction ${view.state?.direction === -1 ? 'reversed' : 'normal'}`}>
            <span aria-hidden style={{ transform: view.state?.direction === -1 ? 'scaleX(-1)' : 'none' }}><Rotate width={16} height={16} /></span>
            <span className="text-[10px] font-pixel tracking-wide">{view.state?.direction === -1 ? 'CCW' : 'CW'}</span>
          </div>
        </div>
      </div>

      {/* whose turn */}
      <div className="text-center my-3" aria-live="polite">
        <span className="font-pixel text-[10px] tracking-wide" style={{ color: yourTurn ? accent : '#ffffff99' }}>
          {yourTurn ? (phase === 'penalty' ? 'STACK OR TAKE' : 'YOUR TURN') : phase === 'gameover' ? 'GAME OVER' : `${currentSeatName(view)} PLAYING…`}
        </span>
      </div>

      {/* your hand */}
      <div>
        <div className="font-pixel text-[8px] tracking-wider text-white/50 mb-2 text-center">
          YOUR HAND · {hand.length} CARD{hand.length === 1 ? '' : 'S'}
        </div>
        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Your hand">
          {hand.map((card) => {
            const active = actionableIds.has(card.id)
            const dim = handInteractive && !active
            return (
              <button
                key={card.id}
                type="button"
                disabled={!handInteractive || !active}
                onClick={() => onCardActivate(card)}
                aria-label={cardAria(card, active, phase)}
                className={`relative rounded-lg transition ${active ? 'hover:-translate-y-1.5 focus-visible:-translate-y-1.5 cursor-pointer' : 'cursor-default'} ${dim ? 'opacity-45' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
                style={active ? { boxShadow: `0 0 0 2px ${accent}, 0 0 16px -2px ${accent}` } : undefined}
              >
                <CardFace card={card} size="lg" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function currentSeatName(view: CardGameView): string {
  const s = view.seats.find((x) => x.current)
  return s ? s.name : 'CPU'
}

function cardAria(card: Card, active: boolean, phase: CardGameView['phase']): string {
  const name = describeForAria(card)
  if (!active) return `${name}, not playable`
  return phase === 'penalty' ? `${name}, stack to pass the penalty` : `${name}, play`
}

// A terse spoken name (the fuller describeCard drives logs/static faces).
function describeForAria(card: Card): string {
  switch (card.kind) {
    case 'number': return `${colorName(card.color)} ${card.value}`
    case 'skip': return `${colorName(card.color)} skip`
    case 'reverse': return `${colorName(card.color)} reverse`
    case 'draw2': return `${colorName(card.color)} draw two`
    case 'wild': return 'Wild'
    case 'wild4': return 'Wild draw four'
  }
}
