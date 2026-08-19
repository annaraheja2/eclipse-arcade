// The Card Game, played with friends — where the hard part is what nobody may
// see.
//
// The other online games put their whole state in the room document, because
// there is nothing in Ascend or Racer worth hiding. A card game is different:
// everyone at the table can read the room document, so a hand kept there is a
// hand everyone can read. Hands live in their own documents instead, one per
// player, readable only by their owner (see firestore.rules -> hands).
//
// THE TRICK THAT AVOIDS A SECOND RULE SET
//
// lib/cardgame.ts holds every hand and the draw pile in one GameState, and its
// reducer is the real, tested rules — skips, reverses, stacking penalties, the
// lot. Rewriting that for split state would mean two rule sets drifting apart.
// So we don't. A turn only ever mutates the hand of the player TAKING it, so
// before applying a move we rebuild a GameState with our own real hand and
// face-down placeholders of the right size for everyone else, run the genuine
// reducer, then split the result back apart. The rules are never reimplemented,
// only re-assembled around the one hand we are allowed to hold.
//
// NO SHARED DRAW PILE
//
// A face-down pile has the same problem as a hand: kept in the room document,
// everyone can read what is coming. So the deck is dealt out at the start —
// each player gets their opening hand plus a private reserve to draw from. The
// cost is that the discard can never be reshuffled back in, so a very long game
// could run a player dry; with 108 cards between four players that is far more
// reserve than a game uses.
//
// Pure. lib/gameroom.ts carries it to Firestore.
import {
  createGame, playCard, stackOrTake, drawToPlay, passTurn, legalPlays, topCard,
  COLORS, type Card, type Color, type Direction, type GameState,
} from './cardgame'

/** What everybody at the table may see. Lives in the room document. */
export interface CardPublic {
  seats: number
  discardTop: Card
  currentColor: Color
  turn: number
  direction: Direction
  pendingDraw: number
  pendingKind: GameState['pendingKind']
  /** How many cards each seat holds — the only thing others learn about a hand. */
  counts: number[]
  winner: number | null
}

/** What only you may see. Lives in your own document under the room. */
export interface CardHand {
  hand: Card[]
  /** Your share of the deck, drawn from privately. */
  reserve: Card[]
}

/** A face-down stand-in for somebody else's card: right count, no information. */
function placeholders(n: number, seat: number): Card[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({
    id: `hidden-${seat}-${i}`, kind: 'number', color: 'red', value: 0,
  } as Card))
}

/** Our own hand, everyone else face-down, our reserve as the pile to draw from. */
function reconstruct(pub: CardPublic, mine: CardHand, seat: number): GameState {
  const players: Card[][] = []
  for (let i = 0; i < pub.seats; i++) {
    players.push(i === seat ? [...mine.hand] : placeholders(pub.counts[i] ?? 0, i))
  }
  return {
    players,
    drawPile: [...mine.reserve],
    discard: [pub.discardTop],
    currentColor: pub.currentColor,
    turn: pub.turn,
    direction: pub.direction,
    pendingDraw: pub.pendingDraw,
    pendingKind: pub.pendingKind,
    winner: pub.winner,
  }
}

/** Split a played-out GameState back into what is shared and what is ours. */
function split(next: GameState, seat: number, seats: number): { pub: CardPublic; mine: CardHand } {
  return {
    pub: {
      seats,
      discardTop: topCard(next),
      currentColor: next.currentColor,
      turn: next.turn,
      direction: next.direction,
      pendingDraw: next.pendingDraw,
      pendingKind: next.pendingKind,
      counts: next.players.map((h) => h.length),
      winner: next.winner,
    },
    mine: { hand: next.players[seat] ?? [], reserve: next.drawPile },
  }
}

/** Opening deal: real hands, and the rest of the deck split into private reserves. */
export function dealTable(seats: number, rng: () => number): { pub: CardPublic; hands: CardHand[] } {
  const g = createGame(seats, rng)
  // Even shares; any remainder simply stays undealt, which is harmless.
  const per = Math.floor(g.drawPile.length / seats)
  const hands: CardHand[] = g.players.map((hand, i) => ({
    hand,
    reserve: g.drawPile.slice(i * per, (i + 1) * per),
  }))
  return {
    pub: {
      seats,
      discardTop: topCard(g),
      currentColor: g.currentColor,
      turn: g.turn,
      direction: g.direction,
      pendingDraw: g.pendingDraw,
      pendingKind: g.pendingKind,
      counts: g.players.map((h) => h.length),
      winner: null,
    },
    hands,
  }
}

export const isMyTurn = (pub: CardPublic, seat: number): boolean =>
  pub.winner === null && pub.turn === seat

/** The cards in our hand we could legally put down — the real rules, unchanged. */
export function myLegalPlays(pub: CardPublic, mine: CardHand, seat: number): Card[] {
  return legalPlays(reconstruct(pub, mine, seat), seat)
}

export type TurnOutcome = 'illegal' | 'played' | 'forfeit' | 'win' | 'stacked' | 'took'

export interface TurnResult {
  pub: CardPublic
  mine: CardHand
  outcome: TurnOutcome
}

/**
 * Put a card down. `correct` is whether the player answered the question that
 * gates the play — a wrong answer forfeits it, exactly as in the solo game.
 */
export function playFromHand(
  pub: CardPublic, mine: CardHand, seat: number, card: Card, correct: boolean, color?: Color,
): TurnResult {
  const res = playCard(reconstruct(pub, mine, seat), seat, card, correct, Math.random, color)
  const { pub: nextPub, mine: nextMine } = split(res.state, seat, pub.seats)
  return { pub: nextPub, mine: nextMine, outcome: res.outcome }
}

/** Answer a pending penalty by stacking onto it, or take the cards. */
export function stackOrTakePenalty(
  pub: CardPublic, mine: CardHand, seat: number, card: Card | null, correct: boolean, color?: Color,
): TurnResult {
  const res = stackOrTake(reconstruct(pub, mine, seat), seat, card, correct, Math.random, color)
  const { pub: nextPub, mine: nextMine } = split(res.state, seat, pub.seats)
  return { pub: nextPub, mine: nextMine, outcome: res.outcome }
}

export interface DrawTurnResult extends Omit<TurnResult, 'outcome'> {
  outcome: 'illegal' | 'drew-playable' | 'drew-pass'
  /** The card drawn, when it can be played straight away. */
  playable: Card | null
}

/** Draw one from our own reserve. Free — no question gates a draw. */
export function drawOne(
  pub: CardPublic, mine: CardHand, seat: number, rng: () => number,
): DrawTurnResult {
  const res = drawToPlay(reconstruct(pub, mine, seat), seat, rng)
  const { pub: nextPub, mine: nextMine } = split(res.state, seat, pub.seats)
  return { pub: nextPub, mine: nextMine, outcome: res.outcome, playable: res.playableDrawn }
}

/** Keep the drawn card and pass instead of playing it. */
export function passAfterDraw(
  pub: CardPublic, mine: CardHand, seat: number,
): { pub: CardPublic; mine: CardHand } {
  return split(passTurn(reconstruct(pub, mine, seat), seat), seat, pub.seats)
}

// ---------------------------------------------------------------------------
// Serialisation — both documents are untrusted input
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const KINDS = ['number', 'skip', 'reverse', 'draw2', 'wild', 'wild4'] as const

export function toCard(v: unknown): Card | null {
  if (!isRecord(v)) return null
  const { id, kind, color, value } = v
  if (typeof id !== 'string' || typeof kind !== 'string') return null
  if (!(KINDS as readonly string[]).includes(kind)) return null
  const wild = kind === 'wild' || kind === 'wild4'
  if (wild) return { id, kind, color: null } as Card
  if (typeof color !== 'string' || !(COLORS as readonly string[]).includes(color)) return null
  if (kind === 'number') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9) return null
    return { id, kind, color, value } as Card
  }
  return { id, kind, color } as Card
}

function toCards(v: unknown): Card[] | null {
  if (!Array.isArray(v)) return null
  const out: Card[] = []
  for (const c of v) {
    const card = toCard(c)
    if (!card) return null
    out.push(card)
  }
  return out
}

/** Narrows the shared state, or null when malformed. */
export function toCardPublic(v: unknown): CardPublic | null {
  if (!isRecord(v)) return null
  const { seats, turn, direction, pendingDraw } = v
  if (typeof seats !== 'number' || seats < 2 || seats > 5) return null
  const top = toCard(v.discardTop)
  const counts = Array.isArray(v.counts) && v.counts.length === seats
    && v.counts.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 108)
    ? (v.counts as number[]) : null
  if (!top || !counts) return null
  if (typeof v.currentColor !== 'string' || !(COLORS as readonly string[]).includes(v.currentColor)) return null
  if (typeof turn !== 'number' || turn < 0 || turn >= seats) return null
  if (direction !== 1 && direction !== -1) return null
  if (typeof pendingDraw !== 'number' || pendingDraw < 0 || pendingDraw > 108) return null
  const winner = typeof v.winner === 'number' && v.winner >= 0 && v.winner < seats ? v.winner : null
  const pendingKind = v.pendingKind === 'draw2' || v.pendingKind === 'wild4' ? v.pendingKind : null
  return {
    seats, discardTop: top, currentColor: v.currentColor as Color, turn,
    direction, pendingDraw, pendingKind: pendingKind as GameState['pendingKind'],
    counts, winner,
  }
}

/** Narrows our own hand document, or null when malformed. */
export function toCardHand(v: unknown): CardHand | null {
  if (!isRecord(v)) return null
  const hand = toCards(v.hand)
  const reserve = toCards(v.reserve)
  if (!hand || !reserve) return null
  return { hand, reserve }
}

const cardData = (c: Card): Record<string, unknown> =>
  c.kind === 'number'
    ? { id: c.id, kind: c.kind, color: c.color, value: c.value }
    : c.kind === 'wild' || c.kind === 'wild4'
      ? { id: c.id, kind: c.kind, color: null }
      : { id: c.id, kind: c.kind, color: c.color }

export function cardPublicData(p: CardPublic): Record<string, unknown> {
  return {
    seats: p.seats,
    discardTop: cardData(p.discardTop),
    currentColor: p.currentColor,
    turn: p.turn,
    direction: p.direction,
    pendingDraw: p.pendingDraw,
    pendingKind: p.pendingKind ?? null,
    counts: p.counts,
    winner: p.winner,
  }
}

export function cardHandData(h: CardHand): Record<string, unknown> {
  return { cards: { hand: h.hand.map(cardData), reserve: h.reserve.map(cardData) } }
}
