import { describe, it, expect } from 'vitest'
import {
  BOARD_PX, FRAME_PX, GRID_PX, TILE_PX, FRAME_FRACTION,
  hash01, tileColorIndex, TILE_PALETTE, squareToCanvasRect,
} from './ascendBoardTexture'
import { BOARD_N, LAST_SQUARE, squareToWorld } from './ascend'

describe('board face layout', () => {
  it('canvas dimensions are consistent', () => {
    expect(GRID_PX).toBe(TILE_PX * BOARD_N)
    expect(BOARD_PX).toBe(GRID_PX + 2 * FRAME_PX)
    expect(FRAME_FRACTION).toBeCloseTo(FRAME_PX / BOARD_PX)
  })

  it('square 1 is bottom-left, 10 bottom-right, 100 top-left (classic layout)', () => {
    expect(squareToCanvasRect(1)).toEqual({ x: FRAME_PX, y: FRAME_PX + 9 * TILE_PX, w: TILE_PX, h: TILE_PX })
    expect(squareToCanvasRect(10).x).toBe(FRAME_PX + 9 * TILE_PX)
    expect(squareToCanvasRect(10).y).toBe(FRAME_PX + 9 * TILE_PX)
    expect(squareToCanvasRect(LAST_SQUARE)).toEqual({ x: FRAME_PX, y: FRAME_PX, w: TILE_PX, h: TILE_PX })
  })

  it('canvas x tracks world x and canvas y tracks world z (flipY UVs)', () => {
    // any two squares: greater world x → greater canvas x; greater world z
    // (nearer camera) → greater canvas y (lower on the image)
    for (const [a, b] of [[1, 10], [1, 91], [23, 67]] as const) {
      const wa = squareToWorld(a)
      const wb = squareToWorld(b)
      const ca = squareToCanvasRect(a)
      const cb = squareToCanvasRect(b)
      expect(Math.sign(cb.x - ca.x)).toBe(Math.sign(wb.x - wa.x))
      expect(Math.sign(cb.y - ca.y)).toBe(Math.sign(wb.z - wa.z))
    }
  })

  it('hash01 is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = hash01(i, 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(hash01(i, 7)).toBe(v)
    }
    expect(hash01(5, 1)).not.toBe(hash01(5, 2))
  })

  it('every square gets a valid palette entry, with plenty of cream', () => {
    let cream = 0
    for (let sq = 1; sq <= LAST_SQUARE; sq++) {
      const idx = tileColorIndex(sq)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(TILE_PALETTE.length)
      if (idx <= 1) cream++
    }
    expect(cream).toBeGreaterThan(20) // the patchwork stays parchment-forward
  })
})
