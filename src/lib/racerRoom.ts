// Racer, played with friends.
//
// The other online games are turn-based: one player moves, everyone waits, the
// board is a single shared state. Racer isn't — four cars move every frame at
// once, and nobody takes turns. Syncing positions frame by frame is out of the
// question: Firestore is a database, not a game transport, and a document only
// takes about one write a second before writes start fighting each other.
//
// So nothing shares a position. Each player simulates their OWN car locally,
// exactly as the solo race already does, and publishes only where they are and
// how fast they're going — on every answer, plus a slow heartbeat. Everyone
// else DEAD RECKONS between those updates: knowing a rival's speed, you can work
// out where they are now without being told. Speed only changes when they answer
// a question, so the guess is right almost all the time and corrects itself the
// moment the next update lands.
//
// That also means each player writes only their own document (one per racer,
// under the room) rather than all four writing one — which is what keeps them
// from colliding.
//
// Pure. lib/gameroom.ts carries it to Firestore.
//
// UNITS — the one thing to get right here. `distance` is whatever the solo
// simulation accumulates, and that is `mph × SECONDS` (advanceDistance adds
// `speed * dt` with dt in seconds and no conversion to hours). So a full race
// pinned at the cap is RACE_SECONDS * MAX_MPH, which is exactly what
// trackFraction normalises by. It is NOT miles, and treating it as miles is off
// by a factor of 3600 — which silently discarded every rival's position as
// "nonsense rather than a fast lap" and froze the whole field on the start line.
// Extrapolate and bound in the same unit the simulation produces.
import { MAX_MPH, RACE_SECONDS, trackFraction } from './racer'

/** Milliseconds in the second `distance` is measured against — see UNITS above. */
const MS_PER_UNIT_TIME = 1_000

/** Where one racer said they were, and when they said it. */
export interface RacerProgress {
  uid: string
  /** Track units travelled at `atMs` (mph × seconds — see UNITS above). */
  distance: number
  /** Miles per hour at `atMs` — what dead reckoning extrapolates with. */
  speed: number
  /** When this was published, by the publisher's clock. */
  atMs: number
  /** Set once when they cross the line or the clock runs out. */
  finished: boolean
}

/**
 * How far ahead of a stale update we're willing to guess. A player who closes
 * their laptop mid-race would otherwise coast to the horizon forever; after this
 * their car simply stops where it was last seen, which reads as "dropped out"
 * rather than "won".
 */
export const MAX_EXTRAPOLATION_MS = 6_000

/** Cars on the grid — one per livery, so the field is four. */
export const MAX_SEATS = 4

/** The furthest anyone could travel in `ms`, flat out. Used to reject a
 *  nonsensical published distance on the way in — see toRacerProgress. */
export function maxDistanceBy(elapsedMs: number): number {
  return (MAX_MPH * Math.max(0, elapsedMs)) / MS_PER_UNIT_TIME
}

/**
 * Where a racer is now: their last published position, plus however far their
 * last published speed carries them since.
 *
 * Deliberately NOT clamped against the race clock. That would need this
 * machine's clock and the publisher's to agree on when the race began, and they
 * don't — `atMs` is stamped by whoever wrote it. A few seconds of skew between
 * two laptops would drag a legitimate racer backwards, which is a far more
 * likely problem than someone hand-editing a distance. The absurd-value guard
 * lives in toRacerProgress instead, where it needs no shared clock.
 */
export function projectedDistance(p: RacerProgress, nowMs: number): number {
  if (p.finished) return Math.max(0, p.distance)
  // Negative elapsed means their clock ran ahead of ours; treat it as "no news
  // yet" rather than winding them back.
  const since = Math.min(Math.max(0, nowMs - p.atMs), MAX_EXTRAPOLATION_MS)
  return Math.max(0, p.distance + (p.speed * since) / MS_PER_UNIT_TIME)
}

export interface Standing {
  uid: string
  distance: number
  /** 0–1 along the track, for the progress bar. */
  fraction: number
  /** 1-based, ties broken by uid so every screen agrees. */
  place: number
  finished: boolean
  /** True when we haven't heard from them for longer than we'll guess. */
  stale: boolean
}

/** The field right now, leader first. Every client computes the same order. */
export function standings(progress: readonly RacerProgress[], nowMs: number): Standing[] {
  const rows = progress.map((p) => {
    const distance = projectedDistance(p, nowMs)
    return {
      uid: p.uid,
      distance,
      fraction: trackFraction(distance),
      place: 0,
      finished: p.finished,
      stale: !p.finished && nowMs - p.atMs > MAX_EXTRAPOLATION_MS,
    }
  })
  // Furthest first; uid breaks a tie so the order is identical everywhere
  // rather than depending on which client sorted it.
  rows.sort((a, b) => b.distance - a.distance || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
  rows.forEach((r, i) => { r.place = i + 1 })
  return rows
}

/** Whether the race is over: the clock has run out, or everyone is home. */
export function raceIsOver(
  progress: readonly RacerProgress[], nowMs: number, raceStartMs: number,
): boolean {
  if (nowMs - raceStartMs >= RACE_SECONDS * 1000) return true
  return progress.length > 0 && progress.every((p) => p.finished)
}

/** Seconds left on the clock, floored at zero. */
export function secondsLeft(nowMs: number, raceStartMs: number): number {
  return Math.max(0, Math.ceil((raceStartMs + RACE_SECONDS * 1000 - nowMs) / 1000))
}

/**
 * Whether it's worth publishing again. Answering changes your speed, so that
 * always goes out; otherwise a slow heartbeat keeps rivals' dead reckoning
 * honest without spending a write a second.
 */
export const HEARTBEAT_MS = 3_000

export function shouldPublish(
  last: RacerProgress | null, speed: number, nowMs: number, answered: boolean,
): boolean {
  if (answered) return true
  if (!last) return true
  if (last.speed !== speed) return true
  return nowMs - last.atMs >= HEARTBEAT_MS
}

// ---------------------------------------------------------------------------
// Serialisation — another client's document is untrusted input
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const finiteIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null

/** Narrows a racer document, or null when it is malformed or out of range. */
export function toRacerProgress(uid: string, data: unknown): RacerProgress | null {
  if (!isRecord(data)) return null
  // A whole race flat out is the hard ceiling; anything beyond it is nonsense
  // rather than a fast lap, so it is rejected instead of rendered.
  const distance = finiteIn(data.distance, 0, maxDistanceBy(RACE_SECONDS * 1000))
  const speed = finiteIn(data.speed, 0, MAX_MPH)
  if (distance === null || speed === null) return null
  const atMs = typeof data.atMs === 'number' && Number.isFinite(data.atMs) ? data.atMs : 0
  return { uid, distance, speed, atMs, finished: data.finished === true }
}

export function racerProgressData(p: Omit<RacerProgress, 'uid'>): Record<string, unknown> {
  return { distance: p.distance, speed: p.speed, atMs: p.atMs, finished: p.finished }
}
