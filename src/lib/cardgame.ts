// Pure rules engine for the math-gated card-shedding game (UNO-style). Every
// function here is deterministic given its inputs — the ONLY source of chance is
// an INJECTED `rng: () => number` (Math.random at the page edge, a seeded
// generator in tests). No Date.now / Math.random lives in this file, so the whole
// model is unit-testable, like `racer.ts`.
//
// The engine never does math: it takes the solve OUTCOME (`solvedCorrectly`) as
// input and resolves turns/effects. Questions come from the curriculum model at
// the UI edge; here a card only carries the TIER it demands (`requiredDifficulty`).
//
// Convention: a pile's TOP is its LAST element (draw = pop the end, play = push
// the end). State is plain immutable data — mutating functions return a fresh
// state and never touch their inputs. `rng` is threaded in as a trailing param
// (not stored in state) wherever a call may need to draw/reshuffle, mirroring how
// racer.ts passes rng into stepRace rather than parking it in the model.

import type { Difficulty } from '../data/subjects'

// ---- cards ---------------------------------------------------------------

export type Color = 'red' | 'yellow' | 'green' | 'blue'
export const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue']

// Discriminated union by `kind`; colored cards carry a Color, wilds carry null.
interface CardBase { id: string }
export interface NumberCard extends CardBase { kind: 'number'; color: Color; value: number }
export interface SkipCard extends CardBase { kind: 'skip'; color: Color }
export interface ReverseCard extends CardBase { kind: 'reverse'; color: Color }
export interface Draw2Card extends CardBase { kind: 'draw2'; color: Color }
export interface WildCard extends CardBase { kind: 'wild'; color: null }
export interface Wild4Card extends CardBase { kind: 'wild4'; color: null }
export type Card = NumberCard | SkipCard | ReverseCard | Draw2Card | WildCard | Wild4Card

// ---- setup constants -----------------------------------------------------

export const HAND_SIZE = 7
export const PLAYER_MIN = 2
export const PLAYER_MAX = 5
export const DEFAULT_PLAYERS = 4
export const DECK_SIZE = 108

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampPlayers = (n: number) => clamp(Math.floor(n) || DEFAULT_PLAYERS, PLAYER_MIN, PLAYER_MAX)

/**
 * A fresh, ordered 108-card UNO deck. Per color: one 0, two each of 1–9, two
 * each of Skip/Reverse/Draw-2 (25). Plus 4 Wild and 4 Wild-Draw-4. Ids are
 * assigned in build order so every dealt card is stably identifiable.
 */
export function makeDeck(): Card[] {
  const deck: Card[] = []
  let seq = 0
  const id = () => `c${seq++}`
  for (const color of COLORS) {
    deck.push({ kind: 'number', color, value: 0, id: id() })
    for (let v = 1; v <= 9; v++) {
      deck.push({ kind: 'number', color, value: v, id: id() })
      deck.push({ kind: 'number', color, value: v, id: id() })
    }
    for (let k = 0; k < 2; k++) {
      deck.push({ kind: 'skip', color, id: id() })
      deck.push({ kind: 'reverse', color, id: id() })
      deck.push({ kind: 'draw2', color, id: id() })
    }
  }
  for (let k = 0; k < 4; k++) {
    deck.push({ kind: 'wild', color: null, id: id() })
    deck.push({ kind: 'wild4', color: null, id: id() })
  }
  return deck
}

/** Fisher–Yates via the injected rng. Immutable: returns a fresh array. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}

// ---- game state ----------------------------------------------------------

export type Direction = 1 | -1
type PendingKind = 'draw2' | 'wild4' | null

export interface GameState {
  players: Card[][]        // hands; index 0 = the human, the rest AI
  drawPile: Card[]         // face-down stock; top = last element
  discard: Card[]          // face-up pile; top = last element
  currentColor: Color      // the active color a play must match (wilds set it)
  turn: number             // index of the player to move
  direction: Direction     // +1 clockwise, -1 after a Reverse
  pendingDraw: number      // draw penalty owed by the player to move (0 = none)
  pendingKind: PendingKind // which penalty is stacking, for strict like-on-like
  winner: number | null    // player index once someone empties their hand
}

const flip = (d: Direction): Direction => (d === 1 ? -1 : 1)

// Index `steps` seats away in `dir`, wrapped into [0, n). Handles negatives.
const seatAway = (turn: number, dir: Direction, n: number, steps = 1) =>
  (((turn + dir * steps) % n) + n) % n

/**
 * Deal a new game: shuffle a full deck, deal 7 to each of `playerCount`
 * (2–5, clamped; defaults to 4 for a nonsensical count), flip the first
 * non-wild card to open the discard, and set the active color from it. Turn 0,
 * direction +1. Any wilds passed over while seeking that opener are buried at
 * the bottom of the stock (so the flip is deterministic and never a wild).
 */
export function createGame(playerCount: number, rng: () => number): GameState {
  const count = clampPlayers(playerCount)
  const deck = shuffle(makeDeck(), rng) // fresh array — safe to consume locally
  const players: Card[][] = Array.from({ length: count }, () => [])
  let cursor = deck.length - 1 // deal & draw from the top (end)
  for (let d = 0; d < HAND_SIZE; d++) {
    for (let p = 0; p < count; p++) players[p].push(deck[cursor--])
  }
  const stock = deck.slice(0, cursor + 1) // what remains, top still last
  const buried: Card[] = []
  let start: Card | undefined
  while (stock.length > 0) {
    const c = stock[stock.length - 1]
    stock.pop()
    if (c.kind === 'wild' || c.kind === 'wild4') { buried.push(c); continue }
    start = c
    break
  }
  // A full deck has 76 non-wild cards, far more than any deal consumes.
  if (!start || start.color === null) throw new Error('createGame: no non-wild opener')
  return {
    players,
    drawPile: [...buried, ...stock], // buried wilds sink to the bottom (front)
    discard: [start],
    currentColor: start.color, // narrowed to Color by the guard above
    turn: 0,
    direction: 1,
    pendingDraw: 0,
    pendingKind: null,
    winner: null,
  }
}

// ---- accessors -----------------------------------------------------------

export const topCard = (state: GameState): Card => state.discard[state.discard.length - 1]
export const winnerOf = (state: GameState): number | null => state.winner
export const handCounts = (state: GameState): number[] => state.players.map((h) => h.length)
/** The player who moves next in the current direction (one seat over). */
export const nextPlayer = (state: GameState): number =>
  seatAway(state.turn, state.direction, state.players.length)

// ---- rules ---------------------------------------------------------------

/**
 * The math tier a card demands before it can be played: number cards are easy,
 * every action/wild card is hard. (The actual question is drawn at the UI edge;
 * the engine only needs the tag.)
 */
export function requiredDifficulty(card: Card): 'easy' | 'hard' {
  return card.kind === 'number' ? 'easy' : 'hard'
}

// Playable on `top` under the active `color`: same color, same number value,
// same action kind, or a wild (playable anytime).
function isPlayable(card: Card, top: Card, color: Color): boolean {
  if (card.kind === 'wild' || card.kind === 'wild4') return true
  if (card.color === color) return true
  if (card.kind === 'number') return top.kind === 'number' && card.value === top.value
  // action card: matches the top only when it's the same action
  return card.kind === top.kind
}

/** Every card in `playerId`'s hand playable on the current top — a normal turn. */
export function legalPlays(state: GameState, playerId: number): Card[] {
  const top = topCard(state)
  return state.players[playerId].filter((c) => isPlayable(c, top, state.currentColor))
}

// Immutable hand edits.
const removeCard = (hand: Card[], id: string): Card[] => hand.filter((c) => c.id !== id)
const setHand = (players: Card[][], playerId: number, hand: Card[]): Card[][] =>
  players.map((h, i) => (i === playerId ? hand : h))

/**
 * Draw `count` cards off the top of the stock, reshuffling the discard (all but
 * its current top) back into the stock via `rng` when it runs dry. Pure: returns
 * fresh piles and the drawn cards. If both piles are exhausted it simply draws
 * fewer — the caller sees a shorter `drawn`.
 */
function drawFrom(
  drawPile: Card[], discard: Card[], count: number, rng: () => number,
): { drawn: Card[]; drawPile: Card[]; discard: Card[] } {
  let pile = [...drawPile]
  let disc = [...discard]
  const drawn: Card[] = []
  for (let i = 0; i < count; i++) {
    if (pile.length === 0) {
      if (disc.length <= 1) break // nothing anywhere left to draw
      const keep = disc[disc.length - 1]
      pile = shuffle(disc.slice(0, -1), rng)
      disc = [keep]
    }
    drawn.push(pile[pile.length - 1])
    pile = pile.slice(0, -1)
  }
  return { drawn, drawPile: pile, discard: disc }
}

// ---- turn resolution -----------------------------------------------------

export type PlayOutcome = 'illegal' | 'forfeit' | 'played' | 'win'
export interface PlayResult { state: GameState; outcome: PlayOutcome }

/**
 * Resolve `playerId` attempting to play `card` on a normal turn.
 * - Not their turn / game over / a pending penalty open / card not held /
 *   not legal / wild without `chosenColor` → unchanged state + 'illegal'.
 * - `solvedCorrectly === false` → FORFEIT: the card stays, the player draws 1,
 *   the turn passes → 'forfeit'.
 * - Correct → the card leaves the hand to the discard and its effect resolves
 *   (number/wild advance one; skip advances two; reverse flips direction, acting
 *   as a skip with 2 players; draw2/wild4 open a pending penalty on the next
 *   player and pass the turn to them). Emptying the hand wins → 'win'.
 */
export function playCard(
  state: GameState, playerId: number, card: Card, solvedCorrectly: boolean,
  rng: () => number, chosenColor?: Color,
): PlayResult {
  const n = state.players.length
  if (state.winner !== null || playerId !== state.turn || state.pendingDraw > 0) {
    return { state, outcome: 'illegal' }
  }
  const hand = state.players[playerId]
  if (!hand.some((c) => c.id === card.id)) return { state, outcome: 'illegal' }
  if (!isPlayable(card, topCard(state), state.currentColor)) return { state, outcome: 'illegal' }
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  if (isWild && !chosenColor) return { state, outcome: 'illegal' }

  // Wrong answer forfeits the play: card stays, draw one, pass the turn.
  if (!solvedCorrectly) {
    const d = drawFrom(state.drawPile, state.discard, 1, rng)
    return {
      state: {
        ...state,
        players: setHand(state.players, playerId, [...hand, ...d.drawn]),
        drawPile: d.drawPile,
        discard: d.discard,
        turn: seatAway(state.turn, state.direction, n),
      },
      outcome: 'forfeit',
    }
  }

  const newHand = removeCard(hand, card.id)
  const discard = [...state.discard, card]
  // Wilds set the active color to the chosen one; colored cards set their own.
  const currentColor: Color = isWild ? (chosenColor ?? state.currentColor) : card.color
  const players = setHand(state.players, playerId, newHand)

  // Emptying the hand wins outright — effects past that point don't matter.
  if (newHand.length === 0) {
    return { state: { ...state, players, discard, currentColor, winner: playerId }, outcome: 'win' }
  }

  let direction = state.direction
  let turn: number
  let pendingDraw = 0
  let pendingKind: PendingKind = null
  switch (card.kind) {
    case 'number':
    case 'wild':
      turn = seatAway(state.turn, direction, n)
      break
    case 'skip':
      turn = seatAway(state.turn, direction, n, 2)
      break
    case 'reverse':
      direction = flip(direction)
      // With two players a reverse is a skip: it comes back to the same player.
      turn = seatAway(state.turn, direction, n, n === 2 ? 2 : 1)
      break
    case 'draw2':
      pendingDraw = 2
      pendingKind = 'draw2'
      turn = seatAway(state.turn, direction, n)
      break
    case 'wild4':
      pendingDraw = 4
      pendingKind = 'wild4'
      turn = seatAway(state.turn, direction, n)
      break
  }
  return {
    state: { ...state, players, discard, currentColor, direction, turn, pendingDraw, pendingKind },
    outcome: 'played',
  }
}

export type StackOutcome = 'illegal' | 'stacked' | 'took' | 'win'
export interface StackResult { state: GameState; outcome: StackOutcome }

/**
 * Resolve a player who faces a pending draw penalty (from a draw2/wild4 played on
 * them). They MAY answer a matching stackable card to pass the accumulated
 * penalty on (strict like-on-like: draw2-on-draw2, wild4-on-wild4), or take it.
 * - `card` matches `pendingKind` AND `solvedCorrectly` → penalty grows (+2/+4)
 *   and passes to the next player; the stacker is not penalized → 'stacked'
 *   (or 'win' if it emptied their hand).
 * - `card === null`, a wrong solve, or a non-matching card → the player DRAWS
 *   the whole accumulated penalty and their turn is skipped → 'took'.
 * A stacked wild4 keeps the active color unless `chosenColor` is supplied.
 */
export function stackOrTake(
  state: GameState, playerId: number, card: Card | null, solvedCorrectly: boolean,
  rng: () => number, chosenColor?: Color,
): StackResult {
  const n = state.players.length
  if (state.winner !== null || playerId !== state.turn || state.pendingDraw === 0) {
    return { state, outcome: 'illegal' }
  }
  const hand = state.players[playerId]
  if (card !== null && !hand.some((c) => c.id === card.id)) return { state, outcome: 'illegal' }

  const stacks = card !== null && card.kind === state.pendingKind
  if (stacks && solvedCorrectly) {
    const add = card.kind === 'draw2' ? 2 : 4
    const newHand = removeCard(hand, card.id)
    const discard = [...state.discard, card]
    const currentColor: Color = card.kind === 'wild4' ? (chosenColor ?? state.currentColor) : card.color
    const players = setHand(state.players, playerId, newHand)
    if (newHand.length === 0) {
      return { state: { ...state, players, discard, currentColor, winner: playerId }, outcome: 'win' }
    }
    return {
      state: {
        ...state, players, discard, currentColor,
        pendingDraw: state.pendingDraw + add,
        turn: seatAway(state.turn, state.direction, n),
      },
      outcome: 'stacked',
    }
  }

  // Take the full penalty and forfeit the turn.
  const d = drawFrom(state.drawPile, state.discard, state.pendingDraw, rng)
  return {
    state: {
      ...state,
      players: setHand(state.players, playerId, [...hand, ...d.drawn]),
      drawPile: d.drawPile,
      discard: d.discard,
      pendingDraw: 0,
      pendingKind: null,
      turn: seatAway(state.turn, state.direction, n),
    },
    outcome: 'took',
  }
}

export type DrawOutcome = 'illegal' | 'drew-playable' | 'drew-pass' | 'drew-forfeit'
export interface DrawResult { state: GameState; outcome: DrawOutcome; playableDrawn: Card | null }

/**
 * A normal turn where the player draws (usually because they hold no legal card).
 * - `solvedCorrectly === true` → draw 1. If the drawn card is legal, the turn
 *   STAYS so the caller may play it on the same solve (no second question) —
 *   returned as `playableDrawn`, outcome 'drew-playable'. Otherwise the turn
 *   passes → 'drew-pass'.
 * - `solvedCorrectly === false` → draw 2 and the turn is skipped → 'drew-forfeit'.
 * Illegal off-turn, once won, or while a penalty is pending (use stackOrTake).
 */
export function drawToPlay(
  state: GameState, playerId: number, solvedCorrectly: boolean, rng: () => number,
): DrawResult {
  const n = state.players.length
  if (state.winner !== null || playerId !== state.turn || state.pendingDraw > 0) {
    return { state, outcome: 'illegal', playableDrawn: null }
  }
  const pass = seatAway(state.turn, state.direction, n)

  if (!solvedCorrectly) {
    const d = drawFrom(state.drawPile, state.discard, 2, rng)
    return {
      state: {
        ...state,
        players: setHand(state.players, playerId, [...state.players[playerId], ...d.drawn]),
        drawPile: d.drawPile,
        discard: d.discard,
        turn: pass,
      },
      outcome: 'drew-forfeit',
      playableDrawn: null,
    }
  }

  const d = drawFrom(state.drawPile, state.discard, 1, rng)
  const base = {
    ...state,
    players: setHand(state.players, playerId, [...state.players[playerId], ...d.drawn]),
    drawPile: d.drawPile,
    discard: d.discard,
  }
  const drawn = d.drawn[0]
  if (drawn && isPlayable(drawn, topCard(state), state.currentColor)) {
    return { state: base, outcome: 'drew-playable', playableDrawn: drawn } // turn stays
  }
  return { state: { ...base, turn: pass }, outcome: 'drew-pass', playableDrawn: null }
}

// ---- AI (pure) -----------------------------------------------------------

export type AiAction =
  | { kind: 'play'; card: Card; chosenColor?: Color }
  | { kind: 'stack'; card: Card; chosenColor?: Color }
  | { kind: 'take' }
  | { kind: 'draw' }

// Shedding priority: dump action cards first, then high numbers, and hoard wilds
// as flexible outs. Higher = played sooner.
function shedPriority(card: Card): number {
  switch (card.kind) {
    case 'draw2': return 40
    case 'skip':
    case 'reverse': return 30
    case 'number': return 10 + card.value // 10–19, high numbers first
    case 'wild': return 5
    case 'wild4': return 4
  }
}

// The AI's most-held color, to declare on a wild. Ties break by COLORS order.
function bestColor(hand: Card[]): Color {
  const counts = new Map<Color, number>()
  for (const c of hand) if (c.color !== null) counts.set(c.color, (counts.get(c.color) ?? 0) + 1)
  let best: Color = COLORS[0]
  let bestN = -1
  for (const color of COLORS) {
    const nc = counts.get(color) ?? 0
    if (nc > bestN) { bestN = nc; best = color }
  }
  return best
}

/**
 * The AI's intended action — pure and deterministic given `rng`. Facing a pending
 * penalty it stacks a matching card if it has one, else takes. On a normal turn
 * it plays its highest-shed-priority legal card (ties broken by `rng`), choosing
 * its most-held color for a wild; with no legal play it draws. The engine does
 * NOT decide the AI's solve here — that's `aiSolves`, so the page can gate the
 * chosen action on the AI's skill.
 */
export function aiChoose(state: GameState, aiId: number, rng: () => number): { action: AiAction } {
  const hand = state.players[aiId]

  if (state.pendingDraw > 0) {
    const stackable = hand.filter((c) => c.kind === state.pendingKind)
    if (stackable.length > 0) {
      const card = stackable[Math.floor(rng() * stackable.length)]
      return { action: card.kind === 'wild4' ? { kind: 'stack', card, chosenColor: bestColor(hand) } : { kind: 'stack', card } }
    }
    return { action: { kind: 'take' } }
  }

  const legal = legalPlays(state, aiId)
  if (legal.length === 0) return { action: { kind: 'draw' } }

  const top = Math.max(...legal.map(shedPriority))
  const best = legal.filter((c) => shedPriority(c) === top)
  const card = best[Math.floor(rng() * best.length)]
  if (card.kind === 'wild' || card.kind === 'wild4') {
    return { action: { kind: 'play', card, chosenColor: bestColor(hand) } }
  }
  return { action: { kind: 'play', card } }
}

// ---- AI skill tuning (mirrors racer.ts's correct-rate approach) ----------
// A spread of competitive-but-beatable baselines; a harder topic makes the whole
// field a touch sharper. The page rolls `aiSolves(rng, rate)` to decide whether
// an AI's chosen action actually goes through.
const BASE_AI_RATES: readonly number[] = [0.82, 0.72, 0.64, 0.55]
const DIFFICULTY_ACCURACY: Record<Difficulty, number> = { easy: -0.06, medium: 0, hard: 0.06 }

/** Per-rival correct-rate (rival 0 = the sharpest), nudged by topic difficulty. */
export function aiCorrectRate(index: number, difficulty: Difficulty = 'medium'): number {
  const base = BASE_AI_RATES[Math.min(Math.max(index, 0), BASE_AI_RATES.length - 1)]
  return clamp(base + DIFFICULTY_ACCURACY[difficulty], 0, 1)
}

/** Whether an AI answers correctly this time — one `rng()` draw against its rate. */
export function aiSolves(rng: () => number, correctRate: number): boolean {
  return rng() < correctRate
}
