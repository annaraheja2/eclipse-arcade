import { describe, it, expect } from 'vitest'
import {
  PLAYER_ANCHOR, CAMERA_HALF_SPAN, EDGE_PAD, START_LAMPS,
  pxPerUnit, layerOffset, carSlot, laneFor, staggeredX, spriteScale, gapSeconds, formatGap,
  speedIntensity, wheelSpinSeconds, startLights,
} from './circuit'
import { COUNTDOWN_SECONDS, MAX_MPH } from './racer'

describe('pxPerUnit', () => {
  it('maps the full camera window across the track width', () => {
    expect(pxPerUnit(900)).toBeCloseTo(900 / 180)
  })
  it('is 0 for an unmeasured track', () => {
    expect(pxPerUnit(0)).toBe(0)
    expect(pxPerUnit(-10)).toBe(0)
  })
})

describe('layerOffset', () => {
  it('always lands in (-tile, 0] so the tiling never gaps', () => {
    for (const world of [0, 1, 37.5, 160, 999, 12345.6]) {
      const off = layerOffset(world, 0.6, 160)
      expect(off).toBeGreaterThan(-160)
      expect(off).toBeLessThanOrEqual(0)
    }
  })
  it('moves the layer left in proportion to its factor', () => {
    expect(layerOffset(100, 1, 1000)).toBe(-100)
    expect(layerOffset(100, 0.25, 1000)).toBe(-25)
  })
  it('wraps exactly at a tile boundary', () => {
    expect(layerOffset(160, 1, 160)).toBeCloseTo(0)
    expect(layerOffset(161, 1, 160)).toBeCloseTo(-1)
  })
  it('handles a backwards world without leaving the range', () => {
    const off = layerOffset(-37, 1, 160)
    expect(off).toBeGreaterThan(-160)
    expect(off).toBeLessThanOrEqual(0)
  })
  it('is 0 for a degenerate tile', () => {
    expect(layerOffset(500, 1, 0)).toBe(0)
  })
})

describe('carSlot', () => {
  const W = 1000
  it('anchors the player (zero delta) at the anchor fraction', () => {
    const slot = carSlot(0, W)
    expect(slot.kind).toBe('onscreen')
    expect(slot.x).toBeCloseTo(PLAYER_ANCHOR * W)
  })
  it('places a car ahead to the right and behind to the left', () => {
    expect(carSlot(30, W).x).toBeGreaterThan(carSlot(0, W).x)
    expect(carSlot(-30, W).x).toBeLessThan(carSlot(0, W).x)
  })
  it('is symmetric about the anchor', () => {
    const ahead = carSlot(20, W).x - PLAYER_ANCHOR * W
    const behind = PLAYER_ANCHOR * W - carSlot(-20, W).x
    expect(ahead).toBeCloseTo(behind)
  })
  it('pins a far-ahead rival to the right edge with an "ahead" chevron', () => {
    const slot = carSlot(CAMERA_HALF_SPAN * 4, W)
    expect(slot).toEqual({ kind: 'pinned', x: W - EDGE_PAD, side: 'ahead' })
  })
  it('pins a far-behind rival to the left edge with a "behind" chevron', () => {
    const slot = carSlot(-CAMERA_HALF_SPAN * 4, W)
    expect(slot).toEqual({ kind: 'pinned', x: EDGE_PAD, side: 'behind' })
  })
  it('never returns a slot outside the padded track', () => {
    for (const d of [-500, -90, -1, 0, 1, 90, 500]) {
      const { x } = carSlot(d, W)
      expect(x).toBeGreaterThanOrEqual(EDGE_PAD)
      expect(x).toBeLessThanOrEqual(W - EDGE_PAD)
    }
  })
  it('degrades safely on an unmeasured track', () => {
    expect(carSlot(50, 0)).toEqual({ kind: 'pinned', x: EDGE_PAD, side: 'behind' })
  })
})

describe('laneFor', () => {
  it('puts the player nearest the camera, largest, lowest and unstaggered', () => {
    const near = laneFor(0)
    expect(near.scale).toBe(1)
    expect(near.x).toBe(0)
    for (const i of [1, 2, 3]) {
      expect(laneFor(i).scale).toBeLessThan(near.scale)
      expect(laneFor(i).y).toBeLessThan(near.y)
    }
  })
  it('staggers rivals across the track so a pack never stacks up', () => {
    const xs = [0, 1, 2, 3].map((i) => laneFor(i).x)
    expect(new Set(xs).size).toBe(xs.length)
  })
  it('recedes monotonically and clamps out-of-range indexes', () => {
    expect(laneFor(2).scale).toBeLessThan(laneFor(1).scale)
    expect(laneFor(99)).toEqual(laneFor(3))
    expect(laneFor(-4)).toEqual(laneFor(0))
  })
})

describe('staggeredX', () => {
  const W = 1000
  it('adds the lane stagger, scaled to the track width', () => {
    expect(staggeredX({ kind: 'onscreen', x: 400 }, 0.085, W)).toBeCloseTo(485)
    expect(staggeredX({ kind: 'onscreen', x: 200 }, 0.085, 500)).toBeCloseTo(242.5)
  })
  it('clamps back inside the padded track so a pinned car never pops', () => {
    expect(staggeredX({ kind: 'pinned', x: W - EDGE_PAD, side: 'ahead' }, 0.17, W)).toBe(W - EDGE_PAD)
    expect(staggeredX({ kind: 'pinned', x: EDGE_PAD, side: 'behind' }, -0.08, W)).toBe(EDGE_PAD)
  })
  it('is continuous across the pinning boundary', () => {
    const justInside = staggeredX(carSlot(CAMERA_HALF_SPAN * 1.3, W), 0.17, W)
    const pinned = staggeredX(carSlot(CAMERA_HALF_SPAN * 4, W), 0.17, W)
    expect(justInside).toBe(pinned)
  })
})

describe('spriteScale', () => {
  it('is 1:1 at the reference width the art is drawn for', () => {
    expect(spriteScale(760)).toBe(1)
  })
  it('shrinks cars with a narrow panel but never past the readability floor', () => {
    expect(spriteScale(380)).toBeCloseTo(0.6)
    expect(spriteScale(100)).toBe(0.6)
  })
  it('never blows cars up beyond their drawn size', () => {
    expect(spriteScale(2000)).toBe(1)
  })
})

describe('gapSeconds / formatGap', () => {
  it('converts a distance deficit into seconds at the car’s pace', () => {
    expect(gapSeconds(30, 15)).toBeCloseTo(2)
  })
  it('is sign-agnostic — a gap is a magnitude', () => {
    expect(gapSeconds(-30, 15)).toBeCloseTo(2)
  })
  it('has no meaning for a stopped car', () => {
    expect(gapSeconds(30, 0)).toBeNull()
    expect(gapSeconds(30, -1)).toBeNull()
  })
  it('formats to one decimal, em-dash when null', () => {
    expect(formatGap(1.24)).toBe('+1.2')
    expect(formatGap(0)).toBe('+0.0')
    expect(formatGap(null)).toBe('—')
  })
})

describe('speedIntensity / wheelSpinSeconds', () => {
  it('normalises against the sim speed cap', () => {
    expect(speedIntensity(0)).toBe(0)
    expect(speedIntensity(MAX_MPH / 2)).toBeCloseTo(0.5)
    expect(speedIntensity(MAX_MPH)).toBe(1)
  })
  it('clamps beyond the cap and below zero', () => {
    expect(speedIntensity(999)).toBe(1)
    expect(speedIntensity(-5)).toBe(0)
  })
  it('spins faster (shorter period) the quicker the car', () => {
    expect(wheelSpinSeconds(MAX_MPH)).toBeLessThan(wheelSpinSeconds(0))
    expect(wheelSpinSeconds(MAX_MPH)).toBeGreaterThan(0)
  })
})

describe('startLights', () => {
  it('lights one lamp per interval, left to right', () => {
    const per = COUNTDOWN_SECONDS / START_LAMPS
    expect(startLights(0)).toEqual({ kind: 'arming', lit: 1 })
    expect(startLights(per * 1.5)).toEqual({ kind: 'arming', lit: 2 })
    expect(startLights(per * 4.9)).toEqual({ kind: 'arming', lit: START_LAMPS })
  })
  it('fills every lamp by the last interval and never overfills', () => {
    expect(startLights(COUNTDOWN_SECONDS - 0.001).kind).toBe('arming')
    const last = startLights(COUNTDOWN_SECONDS - 0.001)
    expect(last.kind === 'arming' && last.lit).toBe(START_LAMPS)
  })
  it('extinguishes all lamps exactly when the race starts', () => {
    expect(startLights(COUNTDOWN_SECONDS)).toEqual({ kind: 'go' })
    expect(startLights(COUNTDOWN_SECONDS + 10)).toEqual({ kind: 'go' })
  })
  it('never reports a negative lamp count before the sequence', () => {
    expect(startLights(-1)).toEqual({ kind: 'arming', lit: 0 })
  })
  it('treats a zero-length countdown as an instant go', () => {
    expect(startLights(0, 0)).toEqual({ kind: 'go' })
  })
})
