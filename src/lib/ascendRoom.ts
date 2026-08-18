// Ascend, played with friends: the shared state that lives in the room document
// and the one reducer every client replays over it.
//
// Same arrangement as Last Standing online — there is no separate online rule
// set, because the climb, the chutes and the scoring all come from lib/ascend.ts
// exactly as the solo game uses them. This module only adds who is on the board,
// whose turn it is, and how a turn advances.
//
// Pure. lib/gameroom.ts carries it to Firestore.
import { LAST_SQUARE, START_SQUARE, resolveMove, nextRacer, placements, finalScore, type Chute } from './ascend'

/** What the last turn did, kept so every client can animate the same hop. */
export interface AscendMove {
  seat: number
  correct: boolean
  /** 0 when the answer was wrong and no die was thrown. */
  roll: number
  from: number
  to: number
  chute: Chute | null
}

export interface AscendState {
  /** Square each seat stands on, indexed by seat. */
  positions: number[]
  /** Questions each seat has answered correctly — the score's first half. */
  correct: number[]
  /** Seat to answer next. */
  turn: number
  /** Seat that reached the top, or -1 while the race is on. */
  winner: number
  /** The turn just played, for the board to animate. Null at the start. */
  last: AscendMove | null
}

export const MAX_SEATS = 4

/** A fresh race with everyone on the start pad. */
export function createAscendState(seatCount: number): AscendState {
  const n = Math.max(1, Math.min(MAX_SEATS, seatCount))
  return {
    positions: new Array<number>(n).fill(START_SQUARE),
    correct: new Array<number>(n).fill(0),
    turn: 0,
    winner: -1,
    last: null,
  }
}

/** Re-seats a lobby as friends come and go, keeping nobody's progress (a lobby
 *  has none) but keeping the shape valid. */
export function resizeAscendState(seatCount: number): AscendState {
  return createAscendState(seatCount)
}

export const isOver = (s: AscendState): boolean => s.winner >= 0

/**
 * Plays one turn: the seat whose turn it is answers, and on a correct answer
 * throws `roll` and climbs. A wrong answer forfeits the throw. Either way the
 * turn passes.
 *
 * `roll` is supplied rather than drawn here so the reducer stays pure and every
 * client lands on the same board — the player taking the turn throws the die and
 * publishes the number with their move.
 */
export function applyAscendAnswer(state: AscendState, correct: boolean, roll: number): AscendState {
  if (isOver(state)) return state
  const seat = state.turn
  const from = state.positions[seat] ?? START_SQUARE

  if (!correct) {
    return {
      ...state,
      correct: state.correct.slice(),
      positions: state.positions.slice(),
      turn: nextRacer(seat, state.positions.length),
      last: { seat, correct: false, roll: 0, from, to: from, chute: null },
    }
  }

  const move = resolveMove(from, roll)
  const positions = state.positions.slice()
  positions[seat] = move.landed
  const correctCounts = state.correct.slice()
  correctCounts[seat] = (correctCounts[seat] ?? 0) + 1

  return {
    positions,
    correct: correctCounts,
    // The winner's turn is the last one played, so the pointer stops moving.
    turn: move.won ? seat : nextRacer(seat, positions.length),
    winner: move.won ? seat : -1,
    last: { seat, correct: true, roll, from, to: move.landed, chute: move.chute },
  }
}

/** Final placings once someone is home: 1st for the winner, then by height. */
export function ascendPlacements(state: AscendState): number[] {
  if (!isOver(state)) return state.positions.map(() => 0)
  return placements(state.positions, state.winner)
}

/** A seat's score, on the same scale the solo game awards. */
export function ascendScoreFor(state: AscendState, seat: number): number {
  const place = ascendPlacements(state)[seat] ?? state.positions.length
  return finalScore(state.correct[seat] ?? 0, place)
}

// ---------------------------------------------------------------------------
// Serialisation — the room document is untrusted input
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const intList = (v: unknown, len: number, lo: number, hi: number): number[] | null => {
  if (!Array.isArray(v) || v.length !== len) return null
  const out: number[] = []
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < lo || n > hi) return null
    out.push(n)
  }
  return out
}

function toChute(v: unknown): Chute | null {
  if (!isRecord(v)) return null
  const { kind, from, to } = v
  if (kind !== 'ladder' && kind !== 'snake') return null
  if (typeof from !== 'number' || typeof to !== 'number') return null
  return { kind, from, to }
}

function toMove(v: unknown, seats: number): AscendMove | null {
  if (!isRecord(v)) return null
  const { seat, correct, roll, from, to } = v
  if (typeof seat !== 'number' || seat < 0 || seat >= seats) return null
  if (typeof correct !== 'boolean') return null
  if (typeof roll !== 'number' || roll < 0 || roll > 6) return null
  if (typeof from !== 'number' || typeof to !== 'number') return null
  return { seat, correct, roll, from, to, chute: toChute(v.chute) }
}

/** Narrows a room document's state, or null when it is malformed. */
export function toAscendState(v: unknown): AscendState | null {
  if (!isRecord(v)) return null
  const { positions, correct, turn, winner } = v
  if (!Array.isArray(positions)) return null
  const seats = positions.length
  if (seats < 1 || seats > MAX_SEATS) return null
  const pos = intList(positions, seats, 0, LAST_SQUARE)
  const cor = intList(correct, seats, 0, 100000)
  if (!pos || !cor) return null
  if (typeof turn !== 'number' || turn < 0 || turn >= seats) return null
  if (typeof winner !== 'number' || winner < -1 || winner >= seats) return null
  return { positions: pos, correct: cor, turn, winner, last: toMove(v.last, seats) }
}

/** Plain JSON for Firestore — `undefined` is rejected by the SDK, so the
 *  optional pieces become null. */
export function ascendStateData(s: AscendState): Record<string, unknown> {
  return {
    positions: s.positions,
    correct: s.correct,
    turn: s.turn,
    winner: s.winner,
    last: s.last
      ? {
        seat: s.last.seat, correct: s.last.correct, roll: s.last.roll,
        from: s.last.from, to: s.last.to,
        chute: s.last.chute ? { ...s.last.chute } : null,
      }
      : null,
  }
}
