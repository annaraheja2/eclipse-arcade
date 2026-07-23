import { describe, it, expect } from 'vitest'
import {
  CAMERA_AHEAD, CAMERA_BEHIND, CAMERA_SPAN, EDGE_PAD, PLAYER_DEPTH, LANES,
  TRACK_METRES, CAR_WIDTH_M, MAX_TYRE_BLUR, START_LAMPS,
  CAMERA_TILT_DEG, CAMERA_PERSPECTIVE_PX, MAX_PLATE_SCALE, PLATE_FLIP_DEPTH,
  CIRCUIT, LAP_LENGTH, CURVE_EASE, MAX_SWAY_FRACTION, MAX_BANK_DEG, MAX_LEAN_DEG,
  pxPerUnit, surfaceOffset, carPlacement, carWidthPx, laneFor,
  projectionScale, plateScale, plateSide, plateDropPx,
  trackCurvature, lapDistance, lapOf, lapFraction, finishLineDelta,
  swayPx, bankDeg, leanDeg,
  gapSeconds, formatGap, speedIntensity, speedFeel, tyreBlurPx, startLights,
} from './circuit'
import { COUNTDOWN_SECONDS, MAX_MPH } from './racer'

// The exact deltas at which `carPlacement` flips between on-camera and pinned.
// Derived from the formula, not copied from it, so a change to either constant
// makes the boundary tests fail loudly rather than follow the code along.
const PIN_AHEAD_AT = CAMERA_AHEAD - EDGE_PAD * CAMERA_SPAN // delta above this pins ahead
const PIN_BEHIND_AT = -(CAMERA_BEHIND - EDGE_PAD * CAMERA_SPAN) // delta below this pins behind

describe('pxPerUnit', () => {
  it('spreads the whole camera window across the plane depth', () => {
    expect(pxPerUnit(880)).toBeCloseTo(880 / CAMERA_SPAN)
    expect(pxPerUnit(880) * CAMERA_SPAN).toBeCloseTo(880)
  })
  it('is 0 for an unmeasured plane', () => {
    expect(pxPerUnit(0)).toBe(0)
    expect(pxPerUnit(-10)).toBe(0)
  })
})

describe('surfaceOffset', () => {
  const TILE = 160
  it('wraps into [0, tile) for any world distance, forwards or backwards', () => {
    for (const world of [-12345.6, -999, -160.5, -37, -0.5, 0, 1, 37.5, 160, 999, 12345.6]) {
      const off = surfaceOffset(world, TILE)
      expect(off).toBeGreaterThanOrEqual(0)
      expect(off).toBeLessThan(TILE)
    }
  })
  it('scrolls toward the camera in step with distance', () => {
    expect(surfaceOffset(0, TILE)).toBe(0)
    expect(surfaceOffset(40, TILE)).toBe(40)
    expect(surfaceOffset(159.5, TILE)).toBeCloseTo(159.5)
  })
  it('resets exactly at a tile boundary so the tiling never seams', () => {
    expect(surfaceOffset(TILE, TILE)).toBe(0)
    expect(surfaceOffset(TILE + 1, TILE)).toBeCloseTo(1)
    expect(surfaceOffset(TILE * 7, TILE)).toBe(0)
  })
  it('folds a negative world back to the top of the tile', () => {
    expect(surfaceOffset(-1, TILE)).toBeCloseTo(159)
    expect(surfaceOffset(-37, TILE)).toBeCloseTo(123)
    expect(surfaceOffset(-TILE - 4, TILE)).toBeCloseTo(156)
  })
  it('is 0 for a degenerate tile', () => {
    expect(surfaceOffset(500, 0)).toBe(0)
    expect(surfaceOffset(500, -8)).toBe(0)
  })
})

describe('carPlacement', () => {
  it('puts the player, at zero delta, exactly at PLAYER_DEPTH', () => {
    expect(carPlacement(0)).toEqual({ kind: 'onscreen', depth: PLAYER_DEPTH })
  })
  it('moves a car toward the horizon as it pulls ahead', () => {
    // depth 0 is the far edge, so a bigger lead means a SMALLER depth.
    const near = carPlacement(-10)
    const mid = carPlacement(0)
    const far = carPlacement(30)
    expect(far.depth).toBeLessThan(mid.depth)
    expect(mid.depth).toBeLessThan(near.depth)
  })
  it('maps delta onto depth linearly across the window', () => {
    expect(carPlacement(44).depth).toBeCloseTo((CAMERA_AHEAD - 44) / CAMERA_SPAN)
    expect(carPlacement(-10).depth).toBeCloseTo((CAMERA_AHEAD + 10) / CAMERA_SPAN)
    // equal steps in delta move a car by equal steps in depth
    const step = carPlacement(10).depth - carPlacement(20).depth
    expect(carPlacement(20).depth - carPlacement(30).depth).toBeCloseTo(step)
    expect(step).toBeCloseTo(10 / CAMERA_SPAN)
  })
  it('shows far more road ahead than behind — that is what a chase camera is for', () => {
    expect(CAMERA_AHEAD).toBeGreaterThan(CAMERA_BEHIND)
    expect(PLAYER_DEPTH).toBeGreaterThan(0.5)
  })

  // The boundary tests below deliberately compare an UNCLAMPED on-camera depth
  // against the clamped pinned one. Asserting two pinned values against each
  // other would pass even if the window logic broke entirely.
  it('keeps a car just inside the ahead boundary on camera, with its true depth', () => {
    const inside = carPlacement(PIN_AHEAD_AT - 1)
    expect(inside.kind).toBe('onscreen')
    expect(inside.depth).toBeCloseTo((CAMERA_AHEAD - (PIN_AHEAD_AT - 1)) / CAMERA_SPAN)
    expect(inside.depth).toBeGreaterThan(EDGE_PAD) // genuinely past the pin, not clamped to it
  })
  it('pins a car just outside the ahead boundary to the far edge', () => {
    expect(carPlacement(PIN_AHEAD_AT + 1)).toEqual({ kind: 'pinned', depth: EDGE_PAD, side: 'ahead' })
    expect(carPlacement(CAMERA_AHEAD * 40)).toEqual({ kind: 'pinned', depth: EDGE_PAD, side: 'ahead' })
  })
  it('keeps a car just inside the behind boundary on camera, with its true depth', () => {
    const inside = carPlacement(PIN_BEHIND_AT + 1)
    expect(inside.kind).toBe('onscreen')
    expect(inside.depth).toBeCloseTo((CAMERA_AHEAD - (PIN_BEHIND_AT + 1)) / CAMERA_SPAN)
    expect(inside.depth).toBeLessThan(1 - EDGE_PAD) // genuinely inside, not clamped to the edge
  })
  it('pins a car just outside the behind boundary to the near edge', () => {
    expect(carPlacement(PIN_BEHIND_AT - 1)).toEqual({ kind: 'pinned', depth: 1 - EDGE_PAD, side: 'behind' })
    expect(carPlacement(-CAMERA_BEHIND * 40)).toEqual({ kind: 'pinned', depth: 1 - EDGE_PAD, side: 'behind' })
  })
  it('never places a car off the padded plane', () => {
    for (const d of [-4000, -90, -22, -1, 0, 1, 58, 90, 4000]) {
      const { depth } = carPlacement(d)
      expect(depth).toBeGreaterThanOrEqual(EDGE_PAD)
      expect(depth).toBeLessThanOrEqual(1 - EDGE_PAD)
    }
  })
  it('moves cars down the plane at exactly the road-scroll rate — the camera lock', () => {
    // If depth-per-unit and pxPerUnit ever diverged, the road would slide
    // under the cars instead of carrying them.
    const D = 880
    for (const delta of [1, 7.5, 20]) {
      const carPx = (carPlacement(0).depth - carPlacement(delta).depth) * D
      expect(carPx).toBeCloseTo(pxPerUnit(D) * delta)
    }
  })
})

describe('laneFor', () => {
  // A car's width as a fraction of the track — the unit both invariants use.
  const CAR_LANE_W = CAR_WIDTH_M / TRACK_METRES
  it('gives every car its own line, a full car width clear of any other', () => {
    const lanes = LANES.map((_, i) => laneFor(i))
    expect(new Set(lanes).size).toBe(LANES.length)
    for (let i = 0; i < lanes.length; i++) {
      for (let j = i + 1; j < lanes.length; j++) {
        expect(Math.abs(lanes[i] - lanes[j])).toBeGreaterThanOrEqual(CAR_LANE_W)
      }
    }
  })
  it('keeps every car FULLY inside the racing surface, edges included', () => {
    for (const lane of LANES) expect(Math.abs(lane) + CAR_LANE_W / 2).toBeLessThanOrEqual(0.5)
  })
  it('puts the player just off the centre line, not on it', () => {
    expect(laneFor(0)).toBe(LANES[0])
    expect(laneFor(0)).not.toBe(0)
  })
  it('clamps an out-of-range index to the end lanes', () => {
    expect(laneFor(99)).toBe(LANES[LANES.length - 1])
    expect(laneFor(-4)).toBe(LANES[0])
  })
})

describe('carWidthPx', () => {
  it('scales the car by the real metre ratio of car to track', () => {
    expect(carWidthPx(TRACK_METRES * 10)).toBeCloseTo(CAR_WIDTH_M * 10)
    expect(carWidthPx(360)).toBeCloseTo((360 / TRACK_METRES) * CAR_WIDTH_M)
  })
  it('leaves room for a field abreast — a car is a fraction of the track', () => {
    expect(carWidthPx(360) / 360).toBeCloseTo(CAR_WIDTH_M / TRACK_METRES)
    expect(carWidthPx(360)).toBeLessThan(360 / 3)
  })
  it('is 0 for an unmeasured track', () => {
    expect(carWidthPx(0)).toBe(0)
    expect(carWidthPx(-40)).toBe(0)
  })
})

describe('projectionScale / plateScale', () => {
  const D = 2200 // a plane depth in the range a desktop stage actually measures
  it('is 1 at the near edge, where the rotation origin leaves z at 0', () => {
    expect(projectionScale(1, D)).toBeCloseTo(1)
  })
  it('shrinks monotonically toward the horizon, never to 0', () => {
    const near = projectionScale(0.9, D)
    const mid = projectionScale(0.5, D)
    const far = projectionScale(EDGE_PAD, D)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
  })
  it('matches the compositor divide P / (P + behind·sin(tilt))', () => {
    const behind = (1 - 0.5) * D * Math.sin((CAMERA_TILT_DEG * Math.PI) / 180)
    expect(projectionScale(0.5, D)).toBeCloseTo(CAMERA_PERSPECTIVE_PX / (CAMERA_PERSPECTIVE_PX + behind))
  })
  it('is neutral for an unmeasured plane and clamps depth to the plane', () => {
    expect(projectionScale(0.3, 0)).toBe(1)
    expect(projectionScale(-2, D)).toBeCloseTo(projectionScale(0, D))
    expect(projectionScale(3, D)).toBeCloseTo(1)
  })
  it('plateScale inverts the divide exactly, so a plate holds screen size', () => {
    for (const depth of [0.3, 0.6, 0.9]) {
      expect(plateScale(depth, D) * projectionScale(depth, D)).toBeCloseTo(1)
    }
  })
  it('caps the compensation so a horizon plate cannot balloon', () => {
    expect(plateScale(0, 100000)).toBe(MAX_PLATE_SCALE)
    for (const depth of [0, 0.5, 1]) expect(plateScale(depth, D)).toBeLessThanOrEqual(MAX_PLATE_SCALE)
  })
})

describe('plateSide', () => {
  it('hangs the plate above the car at ordinary racing depths', () => {
    expect(plateSide(PLAYER_DEPTH)).toBe('above')
    for (const depth of [0.4, 0.6, 0.9, 1]) expect(plateSide(depth)).toBe('above')
  })
  it('flips the plate below the car near the horizon, where above would clip', () => {
    expect(plateSide(PLATE_FLIP_DEPTH - 0.01)).toBe('below')
    expect(plateSide(0.1)).toBe('below')
    expect(plateSide(0)).toBe('below')
  })
  it('always puts a pinned-ahead car (parked at EDGE_PAD) on the below side', () => {
    expect(EDGE_PAD).toBeLessThan(PLATE_FLIP_DEPTH)
    expect(plateSide(carPlacement(CAMERA_AHEAD * 40).depth)).toBe('below')
  })
  it('keeps a pinned-behind car on the ordinary above side', () => {
    expect(plateSide(carPlacement(-CAMERA_BEHIND * 40).depth)).toBe('above')
  })
  it('flips only in the far band — the player can never sit past the threshold', () => {
    expect(PLATE_FLIP_DEPTH).toBeLessThan(PLAYER_DEPTH)
  })
})

describe('plateDropPx', () => {
  // A phone-ish plane and car, in plane-local px, matching what measure() yields.
  const D = 1430
  const CAR = 210
  const PLATE = 22
  const GAP = 6
  const COS = Math.cos((CAMERA_TILT_DEG * Math.PI) / 180)
  it('is 0 for an unmeasured plane', () => {
    expect(plateDropPx(0.05, 0, CAR, PLATE, GAP)).toBe(0)
  })
  it('stands the plate beyond the car’s own plane footprint', () => {
    for (const depth of [0.05, 0.15, 0.3]) {
      expect(plateDropPx(depth, D, CAR, PLATE, GAP)).toBeGreaterThan(CAR / 2)
    }
  })
  it('drops farther the harder the horizon compresses', () => {
    expect(plateDropPx(0.05, D, CAR, PLATE, GAP)).toBeGreaterThan(plateDropPx(0.3, D, CAR, PLATE, GAP))
  })
  it('projects the whole plate clear of the car tail — checked by integrating the true divide', () => {
    for (const depth of [0.05, 0.2, 0.31]) {
      const drop = plateDropPx(depth, D, CAR, PLATE, GAP)
      // Screen distance from car anchor to ground point, summed in small steps.
      let screen = 0
      const STEPS = 400
      for (let i = 0; i < STEPS; i++) {
        const at = depth + (drop / D) * ((i + 0.5) / STEPS)
        screen += (drop / STEPS) * COS * projectionScale(at, D)
      }
      const need = (CAR / 2) * COS * projectionScale(depth, D) + GAP + PLATE
      expect(screen).toBeGreaterThanOrEqual(need * 0.97) // midpoint-iteration tolerance
      expect(screen).toBeLessThanOrEqual(need * 1.1) // and not absurdly far either
    }
  })
})

// Segment geometry derived in the test, not copied from the module internals,
// so a bookkeeping bug in the module's own starts table fails loudly here.
const startOf = (i: number) => CIRCUIT.slice(0, i).reduce((s, seg) => s + seg.length, 0)
const midOf = (i: number) => startOf(i) + CIRCUIT[i].length / 2
const signOf = (seg: (typeof CIRCUIT)[number]) =>
  seg.kind === 'straight' ? 0 : seg.kind === 'right' ? seg.curvature : -seg.curvature

describe('CIRCUIT', () => {
  it('sums its segments to LAP_LENGTH', () => {
    expect(startOf(CIRCUIT.length)).toBe(LAP_LENGTH)
  })
  it('has real corners both ways — it is a circuit, not a drag strip', () => {
    expect(CIRCUIT.some((s) => s.kind === 'left')).toBe(true)
    expect(CIRCUIT.some((s) => s.kind === 'right')).toBe(true)
  })
  it('keeps every corner curvature in the 0..1 sway range', () => {
    for (const s of CIRCUIT) if (s.kind !== 'straight') {
      expect(s.curvature).toBeGreaterThan(0)
      expect(s.curvature).toBeLessThanOrEqual(1)
    }
  })
  it('keeps every segment longer than the ease window, so blends never overlap', () => {
    for (const s of CIRCUIT) expect(s.length).toBeGreaterThanOrEqual(CURVE_EASE)
  })
  it('is far longer than the camera window — at most one finish line on screen', () => {
    expect(LAP_LENGTH).toBeGreaterThan(CAMERA_SPAN * 2)
  })
})

describe('trackCurvature', () => {
  it('reports each segment’s signed curvature at its midpoint, clear of any blend', () => {
    CIRCUIT.forEach((seg, i) => {
      expect(trackCurvature(midOf(i))).toBeCloseTo(signOf(seg))
    })
  })
  it('is negative through a left-hander, positive through a right-hander', () => {
    const left = CIRCUIT.findIndex((s) => s.kind === 'left')
    const right = CIRCUIT.findIndex((s) => s.kind === 'right')
    expect(trackCurvature(midOf(left))).toBeLessThan(0)
    expect(trackCurvature(midOf(right))).toBeGreaterThan(0)
  })
  it('sits exactly halfway between neighbours at a segment boundary', () => {
    for (let i = 1; i < CIRCUIT.length; i++) {
      const mid = (signOf(CIRCUIT[i - 1]) + signOf(CIRCUIT[i])) / 2
      expect(trackCurvature(startOf(i))).toBeCloseTo(mid)
    }
  })
  it('never snaps — fine steps across every boundary stay small', () => {
    for (let i = 0; i <= CIRCUIT.length; i++) {
      const b = startOf(i % CIRCUIT.length) + (i === CIRCUIT.length ? LAP_LENGTH : 0)
      let prev = trackCurvature(b - CURVE_EASE)
      for (let d = b - CURVE_EASE + 0.5; d <= b + CURVE_EASE; d += 0.5) {
        const k = trackCurvature(d)
        expect(Math.abs(k - prev)).toBeLessThan(0.1)
        prev = k
      }
    }
  })
  it('wraps at the lap, so lap 3’s corners land where lap 1’s did', () => {
    for (const d of [0, 55, midOf(3), LAP_LENGTH - 4]) {
      expect(trackCurvature(d + LAP_LENGTH)).toBeCloseTo(trackCurvature(d))
      expect(trackCurvature(d + 2 * LAP_LENGTH)).toBeCloseTo(trackCurvature(d))
    }
  })
  it('never exceeds the strongest authored corner', () => {
    const max = Math.max(...CIRCUIT.map((s) => Math.abs(signOf(s))))
    for (let d = 0; d < LAP_LENGTH; d += 3) {
      expect(Math.abs(trackCurvature(d))).toBeLessThanOrEqual(max)
    }
  })
})

describe('swayPx / bankDeg / leanDeg', () => {
  it('slides the world RIGHT and swings the horizon LEFT through a left-hander', () => {
    expect(swayPx(-1, 1000)).toBeCloseTo(MAX_SWAY_FRACTION * 1000) // positive = right
    expect(bankDeg(-1)).toBeCloseTo(-MAX_BANK_DEG) // negative rotate = far end swings left
    expect(leanDeg(-1)).toBeCloseTo(-MAX_LEAN_DEG) // the car noses left with it
  })
  it('mirrors exactly for a right-hander', () => {
    expect(swayPx(1, 1000)).toBeCloseTo(-swayPx(-1, 1000))
    expect(bankDeg(0.5)).toBeCloseTo(-bankDeg(-0.5))
    expect(leanDeg(0.85)).toBeCloseTo(-leanDeg(-0.85))
  })
  it('is dead level on a straight', () => {
    expect(swayPx(0, 1000)).toBeCloseTo(0)
    expect(bankDeg(0)).toBeCloseTo(0)
    expect(leanDeg(0)).toBeCloseTo(0)
  })
  it('scales sway with the measured plane, so phones and desktops lean alike', () => {
    expect(swayPx(0.5, 2000)).toBeCloseTo(2 * swayPx(0.5, 1000))
    expect(swayPx(0.7, 0)).toBeCloseTo(0)
  })
})

describe('lapDistance / lapOf / lapFraction', () => {
  it('folds any distance into the current lap', () => {
    expect(lapDistance(0)).toBe(0)
    expect(lapDistance(40)).toBe(40)
    expect(lapDistance(LAP_LENGTH)).toBe(0)
    expect(lapDistance(LAP_LENGTH * 2 + 17)).toBeCloseTo(17)
    expect(lapDistance(-5)).toBeCloseTo(LAP_LENGTH - 5)
  })
  it('counts laps from 1 on the grid', () => {
    expect(lapOf(0)).toBe(1)
    expect(lapOf(LAP_LENGTH - 0.1)).toBe(1)
    expect(lapOf(LAP_LENGTH)).toBe(2)
    expect(lapOf(LAP_LENGTH * 2.5)).toBe(3)
  })
  it('never reports lap 0 for a degenerate negative distance', () => {
    expect(lapOf(-3)).toBe(1)
  })
  it('tracks fractional progress through the lap', () => {
    expect(lapFraction(0)).toBe(0)
    expect(lapFraction(LAP_LENGTH / 2)).toBeCloseTo(0.5)
    expect(lapFraction(LAP_LENGTH)).toBe(0)
    expect(lapFraction(LAP_LENGTH * 1.25)).toBeCloseTo(0.25)
  })
})

describe('finishLineDelta', () => {
  it('puts the line under the car on the grid', () => {
    expect(finishLineDelta(0)).toBeCloseTo(0)
  })
  it('trails the line just behind after the start, then drops it off camera', () => {
    expect(finishLineDelta(10)).toBeCloseTo(-10)
    expect(finishLineDelta(CAMERA_BEHIND)).toBeCloseTo(-CAMERA_BEHIND)
    expect(finishLineDelta(CAMERA_BEHIND + 1)).toBeNull()
  })
  it('is empty road for the whole middle of the lap', () => {
    expect(finishLineDelta(LAP_LENGTH / 2)).toBeNull()
  })
  it('brings the next line over the horizon as the lap closes out', () => {
    expect(finishLineDelta(LAP_LENGTH - CAMERA_AHEAD - 1)).toBeNull()
    expect(finishLineDelta(LAP_LENGTH - CAMERA_AHEAD)).toBeCloseTo(CAMERA_AHEAD)
    expect(finishLineDelta(LAP_LENGTH - 5)).toBeCloseTo(5)
  })
  it('repeats identically on every later lap', () => {
    expect(finishLineDelta(LAP_LENGTH + 5)).toBeCloseTo(-5)
    expect(finishLineDelta(LAP_LENGTH * 3 - 20)).toBeCloseTo(20)
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

describe('speedIntensity / tyreBlurPx', () => {
  it('normalises against the sim speed cap', () => {
    expect(speedIntensity(0)).toBe(0)
    expect(speedIntensity(MAX_MPH / 2)).toBeCloseTo(0.5)
    expect(speedIntensity(MAX_MPH)).toBe(1)
  })
  it('clamps beyond the cap and below zero', () => {
    expect(speedIntensity(999)).toBe(1)
    expect(speedIntensity(-5)).toBe(0)
  })
  it('feel is perceptual: steepest through the driven low-mid range', () => {
    expect(speedFeel(0)).toBe(0)
    expect(speedFeel(MAX_MPH)).toBe(1)
    // one +2 mph answer moves the feel MORE at 10 mph than at 26 mph
    const low = speedFeel(12) - speedFeel(10)
    const high = speedFeel(28) - speedFeel(26)
    expect(low).toBeGreaterThan(high)
    // and a 10-mph cruise is already clearly visible, not near-zero
    expect(speedFeel(10)).toBeGreaterThan(0.5)
  })
  it('smears the tyres quadratically, up to the blur ceiling', () => {
    expect(tyreBlurPx(0)).toBe(0)
    expect(tyreBlurPx(MAX_MPH / 2)).toBeCloseTo(MAX_TYRE_BLUR / 4)
    expect(tyreBlurPx(MAX_MPH)).toBeCloseTo(MAX_TYRE_BLUR)
  })
  it('never blurs past the ceiling or into negatives', () => {
    expect(tyreBlurPx(999)).toBe(MAX_TYRE_BLUR)
    expect(tyreBlurPx(-5)).toBe(0)
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
    const last = startLights(COUNTDOWN_SECONDS - 0.001)
    expect(last.kind).toBe('arming')
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
