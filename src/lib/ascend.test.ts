import { describe, it, expect } from 'vitest'
import {
  squareToCell, squareToWorld, rollDie, resolveMove, nextRacer, placements, finalScore,
  LADDERS, SNAKES, TILE, LAST_SQUARE, START_SQUARE,
} from './ascend'

describe('boustrophedon mapping', () => {
  it('runs row 0 left-to-right', () => {
    expect(squareToCell(1)).toEqual({ row: 0, col: 0 })
    expect(squareToCell(10)).toEqual({ row: 0, col: 9 })
  })
  it('reverses odd rows', () => {
    expect(squareToCell(11)).toEqual({ row: 1, col: 9 })
    expect(squareToCell(20)).toEqual({ row: 1, col: 0 })
    expect(squareToCell(21)).toEqual({ row: 2, col: 0 })
  })
  it('ends at 100 in the top-left corner', () => {
    expect(squareToCell(100)).toEqual({ row: 9, col: 0 })
  })
  it('places world coords on the centred grid', () => {
    const half = 4.5 * TILE
    expect(squareToWorld(1)).toEqual({ x: -half, z: half })
    expect(squareToWorld(10)).toEqual({ x: half, z: half })
    expect(squareToWorld(100)).toEqual({ x: -half, z: half - 9 * TILE })
    // the start pad sits one tile west of square 1
    expect(squareToWorld(START_SQUARE)).toEqual({ x: -half - TILE, z: half })
  })
})

describe('rollDie', () => {
  it('spans 1..6 across the RNG range', () => {
    expect(rollDie(() => 0)).toBe(1)
    expect(rollDie(() => 0.5)).toBe(4)
    expect(rollDie(() => 0.999999)).toBe(6)
  })
})

describe('resolveMove', () => {
  it('makes a plain move with a full hop path', () => {
    const m = resolveMove(5, 3)
    expect(m).toEqual({ path: [6, 7, 8], landed: 8, chute: null, won: false })
  })
  it('climbs every ladder from its base', () => {
    for (const [base, top] of Object.entries(LADDERS)) {
      const m = resolveMove(Number(base) - 1, 1)
      expect(m.chute).toEqual({ kind: 'ladder', from: Number(base), to: top })
      expect(m.landed).toBe(top)
    }
  })
  it('slides down every snake from its head', () => {
    for (const [head, tail] of Object.entries(SNAKES)) {
      const m = resolveMove(Number(head) - 1, 1)
      expect(m.chute).toEqual({ kind: 'snake', from: Number(head), to: tail })
      expect(m.landed).toBe(tail)
    }
  })
  it('bounces back off 100 on an overshoot', () => {
    const m = resolveMove(98, 5)
    expect(m.path).toEqual([99, 100, 99, 98, 97])
    expect(m.landed).toBe(97)
    expect(m.won).toBe(false)
  })
  it('wins only on an exact landing at 100', () => {
    expect(resolveMove(97, 3).won).toBe(true)
    expect(resolveMove(99, 1).won).toBe(true)
    expect(resolveMove(99, 2).landed).toBe(99) // 100 then bounce back
  })
  it('wins via the 80 → 100 ladder', () => {
    const m = resolveMove(79, 1)
    expect(m.landed).toBe(LAST_SQUARE)
    expect(m.won).toBe(true)
  })
  it('fires a chute the bounce lands on (96 + 6 → bounce to 98 → snake to 78)', () => {
    const m = resolveMove(96, 6)
    expect(m.path).toEqual([97, 98, 99, 100, 99, 98])
    expect(m.chute).toEqual({ kind: 'snake', from: 98, to: 78 })
    expect(m.landed).toBe(78)
    expect(m.won).toBe(false)
  })
  it('moves off the start pad onto square 1 and climbs its ladder', () => {
    const m = resolveMove(START_SQUARE, 1)
    expect(m.path).toEqual([1])
    expect(m.chute).toEqual({ kind: 'ladder', from: 1, to: 38 })
    expect(m.landed).toBe(38)
  })
})

describe('nextRacer', () => {
  it('advances seats and wraps around', () => {
    expect(nextRacer(0, 3)).toBe(1)
    expect(nextRacer(2, 3)).toBe(0)
  })
})

describe('placements + scoring', () => {
  it('ranks the winner first and the rest by distance climbed', () => {
    expect(placements([40, 100, 62], 1)).toEqual([3, 1, 2])
    expect(placements([100, 5, 5], 0)).toEqual([1, 2, 3]) // tie breaks by seat
  })
  it('scores correct answers plus the placement bonus', () => {
    expect(finalScore(7, 1)).toBe(1700)
    expect(finalScore(3, 2)).toBe(700)
    expect(finalScore(0, 3)).toBe(150)
  })
})
