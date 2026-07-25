// Ascend — snakes-and-ladders race rules. PURE: board geometry, the classic
// chute maps, dice, move resolution (overshoot-bounce + exact-100 win), turn
// order, placements, and scoring. No React, no three, no storage here — the
// page owns state and the board component owns animation.

export const BOARD_N = 10
export const LAST_SQUARE = BOARD_N * BOARD_N
export const START_SQUARE = 0 // the start pad just before square 1

// Classic set. Ladders: base → top. Snakes: head → tail.
export const LADDERS: Readonly<Record<number, number>> = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
}
export const SNAKES: Readonly<Record<number, number>> = {
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
}

// ---- board geometry ----------------------------------------------------------

export interface Cell { row: number; col: number }

/** Square 1..100 → its boustrophedon cell: row 0 runs 1–10 L→R, row 1 R→L, … */
export function squareToCell(sq: number): Cell {
  const i = sq - 1
  const row = Math.floor(i / BOARD_N)
  const within = i % BOARD_N
  const col = row % 2 === 0 ? within : BOARD_N - 1 - within
  return { row, col }
}

export const TILE = 1.15 // world units per square, board centred at the origin

/** World x/z of a square's centre (+x = east, +z = toward the camera side;
 *  row 0 sits at +z). Square 0 is the start pad just west of square 1. */
export function squareToWorld(sq: number): { x: number; z: number } {
  const half = ((BOARD_N - 1) / 2) * TILE
  if (sq === START_SQUARE) return { x: -half - TILE, z: half }
  const { row, col } = squareToCell(sq)
  return { x: col * TILE - half, z: half - row * TILE }
}

// ---- dice + movement ---------------------------------------------------------

/** One standard die roll from an injected RNG (rand ∈ [0, 1)). */
export function rollDie(rand: () => number): number {
  return 1 + Math.min(5, Math.floor(rand() * 6))
}

export interface Chute { kind: 'ladder' | 'snake'; from: number; to: number }

export interface MoveResult {
  path: number[] // every square hopped through, in order (excludes `from`)
  landed: number // final square after any chute fires
  chute: Chute | null // the ladder/snake fired on the hop's last square
  won: boolean // landed exactly on LAST_SQUARE
}

/** Hop `roll` squares from `from`. Overshooting 100 bounces back (98 + 5 →
 *  99, 100, 99, 98, 97); a ladder base climbs, a snake head slides. */
export function resolveMove(from: number, roll: number): MoveResult {
  const path: number[] = []
  let at = from
  let dir = 1
  for (let i = 0; i < roll; i++) {
    if (at === LAST_SQUARE) dir = -1
    at += dir
    path.push(at)
  }
  const end = path.length > 0 ? path[path.length - 1] : from
  const ladder = LADDERS[end]
  const snake = SNAKES[end]
  const chute: Chute | null =
    ladder !== undefined ? { kind: 'ladder', from: end, to: ladder }
      : snake !== undefined ? { kind: 'snake', from: end, to: snake }
        : null
  const landed = chute ? chute.to : end
  return { path, landed, chute, won: landed === LAST_SQUARE }
}

// ---- racers + turn order -----------------------------------------------------

export interface AscendRacer { seat: number; name: string; kind: 'human' | 'ai' }

/** Seat 0 is always you; the two AI rivals just roll on luck. */
export const RACERS: readonly AscendRacer[] = [
  { seat: 0, name: 'YOU', kind: 'human' },
  { seat: 1, name: 'NOVA', kind: 'ai' },
  { seat: 2, name: 'VEGA', kind: 'ai' },
]

export function nextRacer(current: number, count: number): number {
  return (current + 1) % count
}

// ---- placements + scoring ----------------------------------------------------

/** 1-based finishing place per racer when `winner` reaches 100: the winner is
 *  1st; everyone else ranks by how far they climbed (ties break by seat). */
export function placements(positions: readonly number[], winner: number): number[] {
  const rest = positions
    .map((sq, seat) => ({ sq, seat }))
    .filter((e) => e.seat !== winner)
    .sort((a, b) => b.sq - a.sq || a.seat - b.seat)
  const place = new Array<number>(positions.length).fill(1)
  rest.forEach((e, i) => { place[e.seat] = i + 2 })
  return place
}

export const POINTS_PER_CORRECT = 100
export const PLACEMENT_BONUS: readonly number[] = [1000, 400, 150]

/** Session score: +100 per correct answer plus the placement bonus. */
export function finalScore(correct: number, place: number): number {
  return correct * POINTS_PER_CORRECT + (PLACEMENT_BONUS[place - 1] ?? 0)
}
