import type { ReactNode } from 'react'

// ---- Round types ----
export interface PinRound { kind: 'pin'; prompt: string; x: number; y: number; range: number; explain?: string }
export interface SliderRound { kind: 'slider'; prompt: string; answer: number; min: number; max: number; step: number; explain?: string }
export type Round = PinRound | SliderRound

export interface GameDef {
  key: string
  name: string
  color: string
  type: 'pin' | 'slider' | 'battleship' | 'daily' | 'soon'
  rounds: Round[]
}

const pin = (prompt: string, x: number, y: number, range = 10, explain?: string): PinRound => ({ kind: 'pin', prompt, x, y, range, explain })
const sl = (prompt: string, answer: number, min: number, max: number, step = 0.5, explain?: string): SliderRound => ({ kind: 'slider', prompt, answer, min, max, step, explain })

// ---- Sample content (replace with team-authored questions later) ----
const PINPOINT_ROUNDS: PinRound[] = [
  pin('Plot the point  (−3, 2)', -3, 2, 10, 'Go 3 left along x, then 2 up along y.'),
  pin('Plot the y-intercept of  y = 2x + 3', 0, 3, 10, 'The y-intercept is where x = 0, so y = 3 → (0, 3).'),
  pin('Where does  y = 2x + 1  cross the x-axis?', -0.5, 0, 10, 'Set y = 0: 2x + 1 = 0, so x = −0.5.'),
  pin('Plot the vertex of  y = (x − 2)² − 1', 2, -1, 10, 'In y = (x − h)² + k the vertex is (h, k) → (2, −1).'),
  pin('Plot the vertex of  y = (x + 1)² − 4', -1, -4, 10, '(x + 1) means h = −1, and k = −4 → vertex (−1, −4).'),
  pin('Plot the vertex of  y = x²', 0, 0),
  pin('Solve:  y = x  and  x + y = 8.  Plot the solution.', 4, 4, 10, 'Sub y = x into x + y = 8: 2x = 8, x = 4, so (4, 4).'),
  pin('Midpoint of  (0,0)  and  (4,6)', 2, 3, 10, 'Average the coordinates: (0+4)/2 = 2, (0+6)/2 = 3.'),
  pin('Where do  y = x  and  y = −x + 4  intersect?', 2, 2),
  pin('Where does  y = 3x − 6  cross the x-axis?', 2, 0),
]

const SLIDER_ROUNDS: SliderRound[] = [
  sl('Solve:  2x + 4 = 10', 3, -5, 15, 0.5, 'Subtract 4 to get 2x = 6, then divide by 2 → x = 3.'),
  sl('Solve:  x + 5 = 12', 7, 0, 20, 0.5, 'Subtract 5 from both sides → x = 7.'),
  sl('Evaluate  3a + 4  when a = 2', 10, 0, 20, 0.5, 'Substitute a = 2: 3·2 + 4 = 10.'),
  sl('Solve:  3x = 15', 5, 0, 20),
  sl('Evaluate  2³', 8, 0, 20, 0.5, '2³ = 2 · 2 · 2 = 8.'),
  sl('f(x) = 2x + 1.  Find f(3)', 7, -10, 15, 0.5, 'Plug in x = 3: 2·3 + 1 = 7.'),
  sl('Solve:  5x − 3 = 2x + 9', 4, -5, 15, 0.5, 'Move x-terms together: 3x = 12, so x = 4.'),
  sl('Solve  x² = 9  (positive solution)', 3, -10, 10),
  sl('What is 10% of 200?', 20, 0, 50, 0.5, '10% = 0.1, and 0.1 · 200 = 20.'),
  sl('Solve:  x ÷ 2 = 6', 12, 0, 24),
]

export const GAMES: GameDef[] = [
  { key: 'battleship', name: 'Battleship', color: '#3df5ff', type: 'battleship', rounds: [] },
  { key: 'daily', name: 'Daily Challenge', color: '#ffb43d', type: 'daily', rounds: [] },
  { key: 'pinpoint', name: 'PinPoint', color: '#a24bff', type: 'pin', rounds: PINPOINT_ROUNDS },
  { key: 'slider', name: 'Slider', color: '#ffb43d', type: 'slider', rounds: SLIDER_ROUNDS },
  { key: 'gridfill', name: 'Grid-Fill', color: '#3dffa2', type: 'soon', rounds: [] },
  { key: 'matchup', name: 'Match-Up', color: '#ff4d8d', type: 'soon', rounds: [] },
  { key: 'fitline', name: 'Fit-the-Line', color: '#ff6b3d', type: 'soon', rounds: [] },
]

export function getGame(key: string): GameDef | undefined {
  return GAMES.find((g) => g.key === key)
}

// 5 random rounds for a session
export function pickRounds(g: GameDef, n = 5): Round[] {
  const pool = [...g.rounds]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

// ---- Daily Challenge: one deterministic puzzle per calendar date ----
// mulberry32 — a tiny, pure, seedable PRNG so every device gets the same daily.
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// FNV-1a hash of the date string → a stable seed.
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const pool = [...arr]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

const DAILY_POOL: readonly Round[] = [...PINPOINT_ROUNDS, ...SLIDER_ROUNDS]

// Deterministic: same date → same rounds on every device; different dates differ.
export function pickDailyRounds(dateStr: string, n = 5): Round[] {
  return seededShuffle(DAILY_POOL, seededRng(hashSeed(dateStr))).slice(0, n)
}

export const ROUND_MAX = 1000

export function scorePin(r: PinRound, gx: number, gy: number): number {
  const dist = Math.hypot(gx - r.x, gy - r.y)
  return Math.round(ROUND_MAX * Math.exp(-dist / (r.range / 5)))
}
export function scoreSlider(r: SliderRound, g: number): number {
  return Math.round(ROUND_MAX * Math.exp(-Math.abs(g - r.answer) / ((r.max - r.min) / 30)))
}

// used only for typing in components that render an icon prop
export type { ReactNode }
