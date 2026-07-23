// Pure geometry for Racer's side-view circuit — the camera, the parallax layers,
// the timing-tower gaps and the start-light gantry. `lib/racer.ts` owns the
// simulation (distances, speeds, scoring) and is untouched by this file; this is
// only the mapping from that world onto a screen.
//
// The camera anchors the player at a fixed x and scrolls the world past them, so
// EVERY position here is RELATIVE: a rival's slot comes from its distance minus
// the player's, never from absolute progress.

import { MAX_MPH, COUNTDOWN_SECONDS } from './racer'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Where the player's car sits across the viewport (0 = left edge, 1 = right). */
export const PLAYER_ANCHOR = 0.34

/**
 * Half-width of the camera window in simulation distance units. 90 units is ~3
 * seconds at the 30-mph cap, which is roughly the spread an F1 broadcast holds
 * in a single side-on shot before it cuts.
 */
export const CAMERA_HALF_SPAN = 90

/**
 * How close to the panel edge a pinned (off-camera) rival parks, in px. Roughly
 * half a car, so a pinned rival is still mostly visible rather than a sliver.
 */
export const EDGE_PAD = 58

/** Screen px per simulation distance unit for a track of `trackWidth` px. */
export function pxPerUnit(trackWidth: number): number {
  return trackWidth <= 0 ? 0 : trackWidth / (CAMERA_HALF_SPAN * 2)
}

/**
 * Wrapped x-translation for a parallax layer, always in `(-tileWidth, 0]`.
 * The layer element is laid out one tile wider on each side, so translating
 * within that range tiles seamlessly forever with no re-layout.
 */
export function layerOffset(worldPx: number, factor: number, tileWidth: number): number {
  if (tileWidth <= 0) return 0
  const raw = (-worldPx * factor) % tileWidth
  return raw > 0 ? raw - tileWidth : raw
}

/**
 * Where a car sits on screen given its distance lead over the player. A car
 * outside the camera window pins to the edge (dimmed, with a chevron) rather
 * than vanishing — off-screen rivals are still information.
 */
export type CarSlot =
  | { kind: 'onscreen'; x: number }
  | { kind: 'pinned'; x: number; side: 'ahead' | 'behind' }

export function carSlot(deltaDistance: number, trackWidth: number): CarSlot {
  const x = PLAYER_ANCHOR * trackWidth + deltaDistance * pxPerUnit(trackWidth)
  const lo = EDGE_PAD
  const hi = Math.max(EDGE_PAD, trackWidth - EDGE_PAD)
  if (x < lo) return { kind: 'pinned', x: lo, side: 'behind' }
  if (x > hi) return { kind: 'pinned', x: hi, side: 'ahead' }
  return { kind: 'onscreen', x }
}

/**
 * Depth lane for a car: index 0 is the player's near lane (full size, lowest on
 * screen); rivals sit progressively further across the track and smaller, so a
 * pack never collapses into one silhouette. `y` and `x` are both fractions of
 * the panel (height / width). The `x` stagger is FIXED per lane — cars racing
 * side by side sit across the track's width, not on top of each other — so it
 * never distorts how a rival slides backward as you pass them.
 */
export interface Lane { y: number; x: number; scale: number }
const LANES: readonly Lane[] = [
  { y: 0.885, x: 0, scale: 1 },
  { y: 0.805, x: 0.085, scale: 0.85 },
  { y: 0.745, x: -0.08, scale: 0.76 },
  { y: 0.7, x: 0.17, scale: 0.7 },
]
export function laneFor(index: number): Lane {
  return LANES[clamp(index, 0, LANES.length - 1)]
}

/**
 * Sprite scale for the whole field, so a car occupies the same share of a phone
 * panel as of a desktop one. 760px is the reference width the art is drawn for;
 * the floor keeps a car readable rather than letting it shrink to a smudge.
 */
export function spriteScale(trackWidth: number): number {
  return clamp(trackWidth / 760, 0.6, 1)
}

/**
 * Final on-screen x for a car: its camera slot plus its lane's stagger (a
 * fraction of the track width), clamped back inside the padded track. Clamping
 * — rather than dropping the stagger when pinned — is what keeps the slide to
 * the edge continuous, with no pop at the boundary.
 */
export function staggeredX(slot: CarSlot, laneX: number, trackWidth: number): number {
  const lo = EDGE_PAD
  const hi = Math.max(EDGE_PAD, trackWidth - EDGE_PAD)
  return clamp(slot.x + laneX * trackWidth, lo, hi)
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

/** 0..1 road speed — drives speed-lines, camera shake and wheel spin. */
export function speedIntensity(mph: number): number {
  return clamp(mph / MAX_MPH, 0, 1)
}

/** Wheel rotation period in seconds; slower cars spin lazily, the cap blurs. */
export function wheelSpinSeconds(mph: number): number {
  const t = speedIntensity(mph)
  return 0.85 - 0.7 * t
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
