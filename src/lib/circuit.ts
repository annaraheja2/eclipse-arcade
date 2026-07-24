// Pure geometry for Racer's angled-overhead circuit — the camera plane, the
// scrolling surface, the timing-tower gaps and the start-light gantry.
// `lib/racer.ts` owns the simulation (distances, speeds, scoring) and is
// untouched by this file; this is only the mapping from that world onto a road.
//
// The camera is a chase helicopter shot: looking DOWN at the track from behind
// and above. The road is a single CSS-3D plane tilted away from the viewer, so
// perspective — how much a distant car shrinks, how the track narrows toward the
// horizon — is the GPU's job, not arithmetic here.
//
// Everything below is therefore PLANE-LOCAL and linear:
//   `depth`   0 = the far edge (at the horizon) … 1 = the near edge (under the camera)
//   `lateral` a signed fraction of the track's width, 0 = centre line
// Both axes are independent. Depth is the only axis the camera window clips, so
// a car's lateral position can never affect whether it counts as off-camera.

import { MAX_MPH, COUNTDOWN_SECONDS } from './racer'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * The camera window in simulation distance units, split around the player.
 * Far more road is visible ahead than behind — that is what a chase camera is
 * for. 62 units ahead is ~2s at the 30-mph cap.
 */
export const CAMERA_AHEAD = 62
export const CAMERA_BEHIND = 26
export const CAMERA_SPAN = CAMERA_AHEAD + CAMERA_BEHIND

/**
 * How far from the plane's edge a pinned (off-camera) car parks, as a fraction
 * of plane depth. Keeps a pinned car fully on the plane rather than half-cropped.
 */
export const EDGE_PAD = 0.05

/** Where the player sits down the plane — derived, never tuned separately. */
export const PLAYER_DEPTH = CAMERA_AHEAD / CAMERA_SPAN

/** Plane-local px per simulation distance unit, for a plane `planeDepth` px deep. */
export function pxPerUnit(planeDepth: number): number {
  return planeDepth <= 0 ? 0 : planeDepth / CAMERA_SPAN
}

/**
 * Wrapped translation for the scrolling surface, always in `[0, tile)`. The
 * road runs TOWARD the camera, so this grows downward with distance; the
 * surface is laid out one tile longer at its far end, which is what lets it
 * tile seamlessly forever with no re-layout.
 */
export function surfaceOffset(worldPx: number, tile: number): number {
  if (tile <= 0) return 0
  const raw = worldPx % tile
  return raw < 0 ? raw + tile : raw
}

// ---- real-world scale -----------------------------------------------------
// One reference keeps track width, car size and the camera window in agreement,
// so nothing is tuned by eye against anything else.

/** Width of the racing surface, kerb to kerb, in metres. */
export const TRACK_METRES = 12
/** A modern single-seater, in metres. */
export const CAR_LENGTH_M = 5.6
export const CAR_WIDTH_M = 2

/** How wide a car is drawn, given the racing surface's plane-local width. */
export function carWidthPx(trackWidthPx: number): number {
  return trackWidthPx <= 0 ? 0 : (trackWidthPx / TRACK_METRES) * CAR_WIDTH_M
}

/**
 * Where a car sits down the plane, given its distance lead over the player. A
 * car outside the camera window pins to the plane's edge (dimmed, with a
 * chevron) rather than vanishing — off-screen rivals are still information.
 *
 * This is the ONLY place the camera window is applied, and it owns both the
 * clamp and the flag that reports it, so the two can never disagree.
 */
export type CarPlacement =
  | { kind: 'onscreen'; depth: number }
  | { kind: 'pinned'; depth: number; side: 'ahead' | 'behind' }

export function carPlacement(deltaDistance: number): CarPlacement {
  const depth = PLAYER_DEPTH - deltaDistance / CAMERA_SPAN
  if (depth < EDGE_PAD) return { kind: 'pinned', depth: EDGE_PAD, side: 'ahead' }
  if (depth > 1 - EDGE_PAD) return { kind: 'pinned', depth: 1 - EDGE_PAD, side: 'behind' }
  return { kind: 'onscreen', depth }
}

/**
 * Where each car runs across the track, as a signed fraction of track width.
 * Index 0 is the player, just left of the racing line; rivals take their own
 * lines so a pack never collapses into one silhouette. Spacing is deliberately
 * uneven — an evenly-spaced grid reads as a slot-car set, not a race. Every
 * lane keeps the whole car (half a CAR_WIDTH_M each side) on the asphalt,
 * clear of the kerbs, and any two lanes sit at least a full car width apart.
 */
export const LANES: readonly number[] = [-0.09, 0.28, -0.3, 0.1]

export function laneFor(index: number): number {
  return LANES[clamp(index, 0, LANES.length - 1)]
}

// ---- track model ------------------------------------------------------------
// The circuit is a looping sequence of segments in simulation distance units.
// The plane itself is rigid, so a corner is not a bent road mesh: it is the
// WORLD swaying and banking under the camera (see swayPx/bankDeg below and the
// component), the classic pseudo-3D racer read. The model stays pure here.

type TrackSegment =
  | { kind: 'straight'; length: number }
  | { kind: 'left'; length: number; curvature: number }
  | { kind: 'right'; length: number; curvature: number }

/**
 * One lap: straights and corners, curvature 0..1 of the full sway/bank/lean
 * range. Roughly 45s at a mid-race cruise, so a full race runs 3–5 laps.
 * Every segment must be at least CURVE_EASE long or the boundary blends overlap.
 */
export const CIRCUIT: readonly TrackSegment[] = [
  { kind: 'straight', length: 140 }, // start/finish straight
  { kind: 'right', length: 90, curvature: 0.7 },
  { kind: 'straight', length: 60 },
  { kind: 'left', length: 120, curvature: 1 }, // the long hairpin-ish left
  { kind: 'straight', length: 100 },
  { kind: 'left', length: 70, curvature: 0.6 }, // chicane
  { kind: 'right', length: 70, curvature: 0.6 },
  { kind: 'straight', length: 120 },
  { kind: 'right', length: 100, curvature: 0.85 },
  { kind: 'straight', length: 30 }, // short run back onto the start straight
]

export const LAP_LENGTH = CIRCUIT.reduce((sum, s) => sum + s.length, 0)

/** Segment start distances, precomputed once — trackCurvature is per-frame. */
const SEGMENT_STARTS: readonly number[] = CIRCUIT.reduce<number[]>(
  (starts, s, i) => (starts.push(i === 0 ? 0 : starts[i - 1] + CIRCUIT[i - 1].length), starts), [],
)

/** Distance over which curvature crossfades at a segment boundary (half each side). */
export const CURVE_EASE = 18

const signedCurvature = (s: TrackSegment): number =>
  s.kind === 'straight' ? 0 : s.kind === 'right' ? s.curvature : -s.curvature

/** Hermite smoothstep — the eased blend at segment boundaries. */
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c) }

/** Distance folded into the current lap, [0, LAP_LENGTH). */
export function lapDistance(distance: number): number {
  const raw = distance % LAP_LENGTH
  return raw < 0 ? raw + LAP_LENGTH : raw
}

/**
 * Signed curvature of the track at `distance`: negative in a left-hander,
 * positive in a right-hander, 0 on a straight. Piecewise-constant per segment,
 * crossfaded over CURVE_EASE centred on each boundary (including the lap wrap)
 * so entering and leaving a corner is a lean, never a snap.
 */
export function trackCurvature(distance: number): number {
  const d = lapDistance(distance)
  let i = CIRCUIT.length - 1
  for (let s = 0; s < CIRCUIT.length; s++) {
    if (d < SEGMENT_STARTS[s] + CIRCUIT[s].length) { i = s; break }
  }
  const k = signedCurvature(CIRCUIT[i])
  const half = CURVE_EASE / 2
  const into = d - SEGMENT_STARTS[i]
  if (into < half) {
    const prev = signedCurvature(CIRCUIT[(i + CIRCUIT.length - 1) % CIRCUIT.length])
    return prev + (k - prev) * smooth((into + half) / CURVE_EASE)
  }
  const left = CIRCUIT[i].length - into
  if (left < half) {
    const next = signedCurvature(CIRCUIT[(i + 1) % CIRCUIT.length])
    return k + (next - k) * smooth((CURVE_EASE - (left + half)) / CURVE_EASE)
  }
  return k
}

// ---- 3D centreline ----------------------------------------------------------
// The WebGL stage bends the road for REAL: the centreline's heading is the
// integral of trackCurvature along distance. Poses are expressed RELATIVE to an
// anchor distance (the player), so the path never needs to close into a loop —
// the GL scene rebuilds the world around the player every frame from one table.
//
// Conventions: at heading 0 the track runs down −z; positive curvature (a
// right-hander) turns the heading toward +x. The right-hand perpendicular of a
// heading θ is (cos θ, sin θ) in (x, z) — lateral offsets ride on it.

/** Turn rate at full curvature, in radians per metre — a ~45 m corner radius. */
export const TURN_RATE = 1 / 45

export interface Pose { x: number; z: number; heading: number }

/** A strip of centreline poses around an anchor distance, entry i at track
 *  delta (i·step − behind). Flat typed arrays: refilled every frame, sampled
 *  thousands of times (crowd), never reallocated. */
export interface PoseTable {
  /** metres of track behind the anchor covered by entry 0 */
  behind: number
  /** metres between entries */
  step: number
  x: Float32Array
  z: Float32Array
  heading: Float32Array
}

export function makePoseTable(behind: number, ahead: number, step = 1): PoseTable {
  const count = Math.round((behind + ahead) / step) + 1
  return {
    behind,
    step,
    x: new Float32Array(count),
    z: new Float32Array(count),
    heading: new Float32Array(count),
  }
}

/**
 * Fill `table` with centreline poses around `distance`: the anchor entry sits
 * at the origin heading down −z, and every other entry is integrated out from
 * it (midpoint rule, so the backward pass exactly inverts the forward one).
 * Mutates the caller's table — the render loop calls this every frame and
 * must not allocate — but is deterministic in (table shape, distance).
 */
export function fillPoseTable(table: PoseTable, distance: number): void {
  const { behind, step, x, z, heading } = table
  const anchor = Math.round(behind / step)
  x[anchor] = 0
  z[anchor] = 0
  heading[anchor] = 0
  for (let i = anchor + 1; i < x.length; i++) {
    const from = distance + (i - 1 - anchor) * step
    const turn = trackCurvature(from + step / 2) * TURN_RATE * step
    const hMid = heading[i - 1] + turn / 2
    x[i] = x[i - 1] + Math.sin(hMid) * step
    z[i] = z[i - 1] - Math.cos(hMid) * step
    heading[i] = heading[i - 1] + turn
  }
  for (let i = anchor - 1; i >= 0; i--) {
    const from = distance + (i + 1 - anchor) * step
    const turn = trackCurvature(from - step / 2) * TURN_RATE * step
    const hMid = heading[i + 1] - turn / 2
    x[i] = x[i + 1] - Math.sin(hMid) * step
    z[i] = z[i + 1] + Math.cos(hMid) * step
    heading[i] = heading[i + 1] - turn
  }
}

/**
 * Linear sample of the table at `delta` metres from the anchor, clamped to the
 * table's range. Writes into `out` — the frame loop reuses one scratch Pose.
 */
export function samplePose(table: PoseTable, delta: number, out: Pose): void {
  const t = clamp((delta + table.behind) / table.step, 0, table.x.length - 1)
  const i = Math.floor(t)
  const j = Math.min(i + 1, table.x.length - 1)
  const f = t - i
  out.x = table.x[i] + (table.x[j] - table.x[i]) * f
  out.z = table.z[i] + (table.z[j] - table.z[i]) * f
  out.heading = table.heading[i] + (table.heading[j] - table.heading[i]) * f
}

// How hard a full-curvature corner reads, screen-side. The world slides AWAY
// from the turn (a left-hander slides the world right), the horizon end swings
// INTO it via a roll pivoted low on the stage, and each car noses into it.
export const MAX_SWAY_FRACTION = 0.045 // of the plane's width
export const MAX_BANK_DEG = 3
export const MAX_LEAN_DEG = 6

/** Screen-space world slide for a corner — opposite the turn direction. */
export function swayPx(curvature: number, planeWidthPx: number): number {
  return -curvature * planeWidthPx * MAX_SWAY_FRACTION
}

/** World roll (deg): negative (far end swings left) through a left-hander. */
export function bankDeg(curvature: number): number {
  return curvature * MAX_BANK_DEG
}

/** A car's nose-into-the-corner rotation (deg), same sign convention as bank. */
export function leanDeg(curvature: number): number {
  return curvature * MAX_LEAN_DEG
}

// ---- laps -------------------------------------------------------------------

/** 1-based lap the car is on. Lap 1 starts on the grid at distance 0. */
export function lapOf(distance: number): number {
  return Math.floor(Math.max(0, distance) / LAP_LENGTH) + 1
}

/** 0..1 progress through the current lap. */
export function lapFraction(distance: number): number {
  return lapDistance(distance) / LAP_LENGTH
}

/**
 * Where the nearest start/finish line sits relative to the player, in distance
 * units (positive = ahead), or null when no line is inside the camera window.
 * LAP_LENGTH far exceeds the window, so at most one line is ever visible.
 */
export function finishLineDelta(distance: number): number | null {
  const into = lapDistance(distance)
  if (into <= CAMERA_BEHIND) return -into
  const ahead = LAP_LENGTH - into
  return ahead <= CAMERA_AHEAD ? ahead : null
}

// ---- camera optics --------------------------------------------------------
// The numbers live HERE so the projection math below and the CSS transform can
// never disagree: the component writes them onto `.rc-stage` as `--tilt` and
// `perspective`, and the stylesheet only applies them.
export const CAMERA_TILT_DEG = 60
export const CAMERA_PERSPECTIVE_PX = 520

const TILT_SIN = Math.sin((CAMERA_TILT_DEG * Math.PI) / 180)
const TILT_COS = Math.cos((CAMERA_TILT_DEG * Math.PI) / 180)

/**
 * The compositor's perspective divide at `depth` on the tilted plane: how much
 * a screen-parallel element anchored there is scaled on screen. 1 at the near
 * edge (the rotation origin, z = 0), shrinking toward the horizon. Anything
 * that must hold a SCREEN size while riding the plane — a name plate — needs
 * the inverse of this.
 */
export function projectionScale(depth: number, planeDepthPx: number): number {
  if (planeDepthPx <= 0) return 1
  const behind = (1 - clamp(depth, 0, 1)) * planeDepthPx * TILT_SIN
  return CAMERA_PERSPECTIVE_PX / (CAMERA_PERSPECTIVE_PX + behind)
}

/**
 * Inverse-projection scale for a car's name plate: cancels the divide so the
 * plate holds its authored, legible size on screen at any depth. Capped so a
 * horizon plate on a very deep plane compensates almost fully rather than
 * ballooning past its authored size.
 */
export const MAX_PLATE_SCALE = 4
export function plateScale(depth: number, planeDepthPx: number): number {
  return Math.min(1 / projectionScale(depth, planeDepthPx), MAX_PLATE_SCALE)
}

/**
 * Which side of a car its name plate hangs on. Perspective compresses the far
 * end of the plane so hard that near the horizon a plate lifted ABOVE the car
 * projects past the stage's top edge and is clipped by its overflow. Below
 * this depth the plate hangs BELOW the car instead. The threshold was measured
 * against both stage aspects: an above-plate's top crosses y = 0 at depth
 * ~0.28, so 0.32 keeps ~10px of margin at the flip. Pinned-ahead cars (parked
 * at EDGE_PAD) always fall on the 'below' side of it.
 */
export const PLATE_FLIP_DEPTH = 0.32
export function plateSide(depth: number): 'above' | 'below' {
  return depth < PLATE_FLIP_DEPTH ? 'below' : 'above'
}

/**
 * Plane-local Y offset for a 'below' plate's ground point. An upright plate
 * can only rise UP from where it stands on the plane — translating it down in
 * its own space would bury it under the road, where the nearer asphalt
 * occludes it. So a below-plate stands at a point this far DOWN the plane
 * (toward the camera): far enough that the whole plate — `plateHeightPx` tall
 * on screen, rising from that point — projects clear of the car's tail by
 * `gapPx`. Fixed-point iteration, because the perspective divide changes
 * across the offset itself; three rounds land within a pixel.
 */
export function plateDropPx(
  depth: number, planeDepthPx: number, carLengthPx: number, plateHeightPx: number, gapPx: number,
): number {
  if (planeDepthPx <= 0) return 0
  const atCar = projectionScale(depth, planeDepthPx)
  const screenTarget = (carLengthPx / 2) * TILT_COS * atCar + gapPx + plateHeightPx
  let drop = screenTarget / (TILT_COS * atCar)
  for (let i = 0; i < 3; i++) {
    const midway = projectionScale(depth + drop / (2 * planeDepthPx), planeDepthPx)
    drop = screenTarget / (TILT_COS * midway)
  }
  return drop
}

/**
 * Broadcast time gap: how long the trailing car needs to cover `deltaDistance`
 * at its own pace. A stopped car has no meaningful gap — null, rendered as a dash.
 */
export function gapSeconds(deltaDistance: number, speed: number): number | null {
  if (speed <= 0) return null
  return Math.abs(deltaDistance) / speed
}

/** "+1.2" for a real gap, an em-dash when the car is stopped. */
export function formatGap(seconds: number | null): string {
  return seconds === null ? '—' : `+${seconds.toFixed(1)}`
}

/** 0..1 linear speed fraction — the gauge scale (Speedo bar). */
export function speedIntensity(mph: number): number {
  return clamp(mph / MAX_MPH, 0, 1)
}

/**
 * 0..1 PERCEPTUAL speed for the world FX (streaks, shake). Square-root shaped:
 * linear intensity leaves the whole low-mid range invisible (one +2 mph answer
 * is 1/15 of the scale), so the curve is steepest where the race is actually
 * driven — a change at 10 mph reads as clearly as one at 26.
 */
export function speedFeel(mph: number): number {
  return Math.sqrt(speedIntensity(mph))
}

/**
 * Motion blur on a car's tyres, in px. Seen from above a spinning wheel gives
 * itself away by smearing, not by turning — there is no rotation to animate at
 * this camera angle, so speed reads through blur instead. Quadratic: real
 * wheels only smear once they are genuinely fast, so the blur stays off the
 * crawl and bites toward the cap.
 */
export const MAX_TYRE_BLUR = 3
export function tyreBlurPx(mph: number): number {
  const t = speedIntensity(mph)
  return t * t * MAX_TYRE_BLUR
}

// ---- start-light gantry ---------------------------------------------------
// Five lamps illuminate left-to-right across the countdown, then all extinguish
// on the same frame the race starts — the real F1 start sequence. At the 3s
// COUNTDOWN_SECONDS that is one lamp every 0.6s.
export const START_LAMPS = 5

export type StartLights = { kind: 'arming'; lit: number } | { kind: 'go' }

export function startLights(elapsed: number, countdown: number = COUNTDOWN_SECONDS): StartLights {
  if (countdown <= 0 || elapsed >= countdown) return { kind: 'go' }
  const per = countdown / START_LAMPS
  return { kind: 'arming', lit: clamp(Math.floor(elapsed / per) + 1, 0, START_LAMPS) }
}
