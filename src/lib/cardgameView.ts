// Pure presentation + scoring helpers for the card game. No React, no effects —
// the same discipline as lib/racer.ts and lib/battleship.ts. The rules engine
// (lib/cardgame.ts) stays untouched; this file only DESCRIBES its data (labels
// for logs/aria) and DERIVES end-of-game placement + reward score. Everything
// here is deterministic and unit-tested.

import type { Card, Color } from './cardgame'

// ---- labels (color-blind support: every card carries a text name, never just a hue) ----

const COLOR_NAME: Record<Color, string> = {
  red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue',
}

/** Human-readable color name, capitalized (e.g. 'Blue'). */
export function colorName(color: Color): string {
  return COLOR_NAME[color]
}

/**
 * A full spoken/written name for a card — used for the AI ticker, the turn log,
 * and every card's aria-label. Wilds append the active/declared color when known
 * so the discard never reads as a bare "Wild" once a color is in force.
 */
export function describeCard(card: Card, chosenColor?: Color | null): string {
  switch (card.kind) {
    case 'number': return `${colorName(card.color)} ${card.value}`
    case 'skip': return `${colorName(card.color)} Skip`
    case 'reverse': return `${colorName(card.color)} Reverse`
    case 'draw2': return `${colorName(card.color)} Draw Two`
    case 'wild': return chosenColor ? `Wild (${colorName(chosenColor)})` : 'Wild'
    case 'wild4': return chosenColor ? `Wild Draw Four (${colorName(chosenColor)})` : 'Wild Draw Four'
  }
}

/** The compact glyph shown big on a card face (number, or a short action tag). */
export function cardGlyph(card: Card): string {
  switch (card.kind) {
    case 'number': return String(card.value)
    case 'skip': return 'SKIP'
    case 'reverse': return 'REV'
    case 'draw2': return '+2'
    case 'wild': return 'WILD'
    case 'wild4': return '+4'
  }
}

// ---- placement ----------------------------------------------------------

/**
 * A player's finishing place (1 = best) from the final hand sizes: one more than
 * the number of players holding STRICTLY fewer cards. The winner (0 cards) is
 * always 1st; ties share the higher place. Pure over the handCounts array.
 */
export function placementFor(handCounts: readonly number[], playerId: number): number {
  const mine = handCounts[playerId]
  let ahead = 0
  for (let i = 0; i < handCounts.length; i++) {
    if (i !== playerId && handCounts[i] < mine) ahead++
  }
  return ahead + 1
}

// ---- reward score -------------------------------------------------------

export const CARDGAME_WIN_SCORE = 3000
const FINISH_BASE = 300 // floor for finishing at all, so last place still pays out
const SHED_BONUS_MAX = 600 // full bonus for an empty hand
const SHED_CARD_CAP = 20 // holding this many cards (or more) earns no shed bonus

/**
 * Points fed to finishGame('cardgame', …). Rewards placement first (linear from
 * the winner down to 0 for last) and hand-shedding second (the fewer cards you
 * were left holding, the closer you came). Pure and monotonic: a better
 * placement never scores less, and holding more cards never scores more. A
 * 4-player win with an empty hand tops out at 3900 (~ Battleship's 3000 win),
 * last place bottoms out at FINISH_BASE.
 */
export function cardGameScore(placement: number, playerCount: number, cardsLeft: number): number {
  const pc = Math.max(2, Math.floor(playerCount))
  const place = Math.min(Math.max(1, Math.floor(placement)), pc)
  const held = Math.max(0, Math.floor(cardsLeft))
  const placementScore = Math.round((CARDGAME_WIN_SCORE * (pc - place)) / (pc - 1))
  const shed = Math.round((SHED_BONUS_MAX * Math.max(0, SHED_CARD_CAP - held)) / SHED_CARD_CAP)
  return FINISH_BASE + placementScore + shed
}
