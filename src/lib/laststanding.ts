// Pure rules engine for Last Standing — a timed-question elimination game
// around a table. Everyone alive gets 2 lives per round; a wrong answer (or a
// timeout, which the page reports as `correct: false`) costs a life. Each
// player's allotted time shrinks by a second every turn THEY take, so mistakes
// become inevitable and every round resolves. The last player standing wins
// the round and BANISHES one player from the lobby for good; lives reset and
// the next round runs until a single champion remains.
//
// Like cardgame.ts / racer.ts, this file is deterministic: no Math.random,
// no Date, no React. The page owns the real countdown and the rng, and feeds
// outcomes in (`applyAnswer(state, correct)`).

import type { Difficulty } from '../data/subjects'

// ---- constants -----------------------------------------------------------

export const SEAT_COUNT = 5
export const LIVES = 2
export const TURN_TIME_MAX = 30 // seconds on a player's first turn of a round
export const TURN_TIME_MIN = 5 // the floor the per-turn ramp clamps to

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---- state ---------------------------------------------------------------

export type SeatKind = 'human' | 'ai'

export interface Seat {
  seat: number // fixed index around the table — never reused
  name: string
  kind: SeatKind
  lives: number // lives left THIS round; 0 = eliminated for the round
  turnsTaken: number // turns taken THIS round — drives the shrinking timer
  inLobby: boolean // false once banished — permanently out
}

// Discriminated phase union — the whole game flow narrows on `kind`.
export type Phase =
  | { kind: 'turn' } // someone is (or is about to be) answering
  | { kind: 'banish'; winner: number } // the round winner picks a target
  | { kind: 'champion'; champion: number } // game over

export interface LsState {
  seats: Seat[]
  round: number // 1-based
  turn: number // seat index whose turn it is (meaningful in phase 'turn')
  phase: Phase
}

// ---- setup ---------------------------------------------------------------

/**
 * A fresh lobby: seat 0 is the human, every other name is an AI. (The "friend"
 * seat is just the first AI name in v1 — real online friends are a v2.)
 * Round 1, seat 0 to move.
 */
export function createLobby(aiNames: readonly string[]): LsState {
  const seats: Seat[] = [
    { seat: 0, name: 'YOU', kind: 'human', lives: LIVES, turnsTaken: 0, inLobby: true },
    ...aiNames.map((name, i): Seat => (
      { seat: i + 1, name, kind: 'ai', lives: LIVES, turnsTaken: 0, inLobby: true }
    )),
  ]
  return { seats, round: 1, turn: 0, phase: { kind: 'turn' } }
}

// ---- accessors -----------------------------------------------------------

/** Still contesting THIS round: in the lobby and holding at least one life. */
export const isAlive = (s: Seat): boolean => s.inLobby && s.lives > 0

export const aliveSeats = (state: LsState): Seat[] => state.seats.filter(isAlive)
export const lobbySeats = (state: LsState): Seat[] => state.seats.filter((s) => s.inLobby)

/** The next alive seat after `from`, scanning around the table. */
function nextAliveSeat(seats: readonly Seat[], from: number): number {
  const n = seats.length
  for (let step = 1; step <= n; step++) {
    const s = seats[(from + step) % n]
    if (isAlive(s)) return s.seat
  }
  return from // no one else alive — caller resolves the round instead
}

// ---- the timer ramp ------------------------------------------------------

/**
 * Seconds allotted for a player's next turn given how many turns they've
 * already taken this round: 30, 29, 28, … clamped to the 5s floor. THE
 * difficulty ramp — resets each round because `turnsTaken` does.
 */
export function timeForTurn(turnsTaken: number): number {
  return clamp(TURN_TIME_MAX - turnsTaken, TURN_TIME_MIN, TURN_TIME_MAX)
}

// ---- turn resolution -----------------------------------------------------

/**
 * Resolve the current player's turn. Correct → nothing happens; wrong or a
 * timeout (`correct: false`) → they lose a life, and at 0 they're eliminated
 * for the round. Either way their turn counts toward the timer ramp, and play
 * advances to the next alive seat — unless one player is left standing, which
 * ends the round into the banish phase. Illegal outside phase 'turn'.
 */
export function applyAnswer(state: LsState, correct: boolean): LsState {
  if (state.phase.kind !== 'turn') return state
  const actor = state.seats[state.turn]
  if (!isAlive(actor)) return state

  const seats = state.seats.map((s) => (
    s.seat === actor.seat
      ? { ...s, turnsTaken: s.turnsTaken + 1, lives: correct ? s.lives : s.lives - 1 }
      : s
  ))
  const alive = seats.filter(isAlive)
  if (alive.length <= 1) {
    // Last one standing wins the round. (`alive` can't be empty: with one
    // alive player we'd already be in 'banish', so the loser here leaves at
    // least one survivor.)
    const winner = alive.length === 1 ? alive[0].seat : actor.seat
    return { ...state, seats, phase: { kind: 'banish', winner } }
  }
  return { ...state, seats, turn: nextAliveSeat(seats, actor.seat) }
}

// ---- the banish ----------------------------------------------------------

/**
 * The round winner permanently removes `target` from the lobby. If one player
 * remains after the kick they're the champion; otherwise lives and the timer
 * ramp reset and the next round begins with the winner leading off. Illegal
 * outside phase 'banish', or against the winner themself / a seat already out.
 */
export function banish(state: LsState, target: number): LsState {
  if (state.phase.kind !== 'banish') return state
  const winner = state.phase.winner
  const victim = state.seats[target]
  if (!victim || !victim.inLobby || target === winner) return state

  const kicked = state.seats.map((s) => (s.seat === target ? { ...s, inLobby: false } : s))
  const remaining = kicked.filter((s) => s.inLobby)
  if (remaining.length === 1) {
    return { ...state, seats: kicked, phase: { kind: 'champion', champion: remaining[0].seat } }
  }
  const seats = kicked.map((s) => (s.inLobby ? { ...s, lives: LIVES, turnsTaken: 0 } : s))
  return { seats, round: state.round + 1, turn: winner, phase: { kind: 'turn' } }
}

// ---- AI ------------------------------------------------------------------

// Per-AI base accuracy, seat order (the "friend" placeholder is index 0 — the
// sharpest rival), nudged by topic difficulty like the card game's field.
const BASE_AI_RATES: readonly number[] = [0.85, 0.75, 0.65, 0.55]
const DIFFICULTY_ACCURACY: Record<Difficulty, number> = { easy: -0.06, medium: 0, hard: 0.06 }

/** Base correct-rate for AI number `index` (0 = the sharpest). */
export function aiRateFor(index: number, difficulty: Difficulty = 'medium'): number {
  const base = BASE_AI_RATES[clamp(index, 0, BASE_AI_RATES.length - 1)]
  return clamp(base + DIFFICULTY_ACCURACY[difficulty], 0, 1)
}

/**
 * An AI's chance of answering correctly given its allotted seconds this turn.
 * Accuracy scales down linearly with the shrinking timer — full rate at 30s,
 * ~40% of it at the 5s floor — so short timers force the misses that resolve
 * a round.
 */
export function aiAnswerChance(rate: number, seconds: number): number {
  const t = clamp(seconds, TURN_TIME_MIN, TURN_TIME_MAX) / TURN_TIME_MAX
  return clamp(rate * (0.3 + 0.7 * t), 0, 1)
}

/** One rng draw against the chance — the page's only source of AI randomness. */
export function aiSolves(rng: () => number, chance: number): boolean {
  return rng() < chance
}

/**
 * The AI round-winner's banish pick: the biggest threat among the other lobby
 * players — whoever lasted longest this round (most turns taken), then most
 * lives left, ties broken by lowest seat. Deterministic; returns -1 only for
 * a malformed state with no valid target.
 */
export function aiBanishTarget(state: LsState, winner: number): number {
  const candidates = state.seats.filter((s) => s.inLobby && s.seat !== winner)
  if (candidates.length === 0) return -1
  return candidates.reduce((best, s) => (
    s.turnsTaken > best.turnsTaken
    || (s.turnsTaken === best.turnsTaken && s.lives > best.lives)
      ? s : best
  )).seat
}

// ---- scoring -------------------------------------------------------------

/**
 * The human's final score by placement (1 = champion) among `seatCount`
 * starters. Champion pays 1000 per seat at the table; everyone else earns 750
 * per player they outlasted. 5 seats: 5000 / 2250 / 1500 / 750 / 0.
 */
export function scoreForPlacement(placement: number, seatCount: number): number {
  if (placement <= 1) return seatCount * 1000
  return Math.max(0, seatCount - placement) * 750
}
