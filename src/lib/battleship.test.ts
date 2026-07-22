import { describe, it, expect } from 'vitest'
import {
  N, FLEET, shipCells, placementOk, isHoriz, anchorOf, moveShip, rotateShip, nearestValidAnchor,
  shipClass,
  type Ship,
} from './battleship'

const ship = (id: string, r: number, c: number, size: number, horiz: boolean): Ship => ({
  id, size, cells: shipCells(r, c, size, horiz), hits: 0,
})

describe('orientation + anchor helpers', () => {
  it('detects horizontal vs vertical', () => {
    expect(isHoriz(shipCells(2, 1, 3, true))).toBe(true)
    expect(isHoriz(shipCells(2, 1, 3, false))).toBe(false)
  })
  it('anchorOf returns the top-left cell', () => {
    expect(anchorOf(shipCells(4, 2, 3, true))).toEqual({ r: 4, c: 2 })
    expect(anchorOf(shipCells(4, 2, 3, false))).toEqual({ r: 4, c: 2 })
  })
})

describe('shipClass', () => {
  it('gives every fleet ship a distinct visual class', () => {
    const classes = FLEET.map((d) => shipClass(d.id))
    expect(new Set(classes).size).toBe(FLEET.length)
  })
})

describe('moveShip', () => {
  it('relocates the anchor while preserving orientation and size', () => {
    const s = ship('a', 0, 0, 3, true)
    const moved = moveShip(s, 5, 2)
    expect(anchorOf(moved.cells)).toEqual({ r: 5, c: 2 })
    expect(isHoriz(moved.cells)).toBe(true)
    expect(moved.cells).toHaveLength(3)
    expect(moved.id).toBe('a')
  })
})

describe('rotateShip', () => {
  it('flips orientation about the anchor', () => {
    const s = ship('a', 2, 2, 3, true)
    const rot = rotateShip(s)
    expect(isHoriz(rot.cells)).toBe(false)
    expect(anchorOf(rot.cells)).toEqual({ r: 2, c: 2 })
    expect(rotateShip(rot).cells.every((x) => x.r === 2)).toBe(true) // rotating twice returns horizontal
  })
})

describe('nearestValidAnchor', () => {
  it('returns the exact target when it is already legal', () => {
    const got = nearestValidAnchor(3, true, 4, 4, [])
    expect(got).toEqual({ r: 4, c: 4 })
  })

  it('skips the "no ships touch" halo and finds the closest legal anchor', () => {
    // Occupy the top-left; adjacency (incl. diagonal) is illegal, so a 2-cell horizontal
    // ship aimed at (0,0) must be pushed clear of the existing ship's halo.
    const existing = [ship('x', 0, 0, 2, true)] // occupies (0,0),(0,1); halo blocks rows 0-1, cols 0-2
    const got = nearestValidAnchor(2, true, 0, 0, existing)
    expect(got).not.toBeNull()
    expect(placementOk(shipCells(got!.r, got!.c, 2, true), existing)).toBe(true)
    // nearest legal row for a horizontal ship near the top is row 2 (halo covers rows 0-1)
    expect(got!.r).toBe(2)
  })

  it('keeps the returned anchor in bounds', () => {
    const got = nearestValidAnchor(4, true, 0, N - 1, [])
    expect(got).not.toBeNull()
    expect(got!.c).toBeLessThanOrEqual(N - 4)
    expect(placementOk(shipCells(got!.r, got!.c, 4, true), [])).toBe(true)
  })

  it('returns null when nothing legal exists within the search radius', () => {
    // A vertical size-3 ship aimed at the far corner with a tiny radius and a blocker nearby.
    const existing = [ship('x', 0, 0, 3, false)]
    const got = nearestValidAnchor(3, false, 0, 0, existing, 0) // radius 0 = only the (illegal) target
    expect(got).toBeNull()
  })
})
