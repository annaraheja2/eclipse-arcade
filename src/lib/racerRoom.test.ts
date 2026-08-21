import { describe, it, expect } from 'vitest'
import {
  projectedDistance, standings, raceIsOver, secondsLeft, shouldPublish,
  toRacerProgress, racerProgressData, maxDistanceBy,
  MAX_EXTRAPOLATION_MS, HEARTBEAT_MS, type RacerProgress,
} from './racerRoom'
import { MAX_MPH, RACE_SECONDS, advanceDistance } from './racer'

const START = 1_000_000
const at = (over: Partial<RacerProgress> = {}): RacerProgress =>
  ({ uid: 'a', distance: 0, speed: 20, atMs: START, finished: false, ...over })

// Track units covered at `mph` for `ms` — mph × SECONDS, the unit the solo
// simulation accumulates (see the UNITS note in racerRoom.ts). These fixtures
// used to be written in miles, which is why a 3600× mismatch against the
// simulation passed the whole suite while the field sat frozen on the grid.
const units = (mph: number, ms: number) => (mph * ms) / 1_000

/** A full race pinned at the cap — the top of the scale everything lives on. */
const FULL_RACE = RACE_SECONDS * MAX_MPH

describe('dead reckoning', () => {
  it('returns the published position at the moment it was published', () => {
    expect(projectedDistance(at({ distance: 1800 }), START)).toBeCloseTo(1800, 6)
  })

  it('carries a racer forward at their last known speed', () => {
    const p = at({ distance: 1800, speed: 24 })
    expect(projectedDistance(p, START + 2000)).toBeCloseTo(1800 + units(24, 2000), 6)
  })

  it('does not move a stopped car', () => {
    expect(projectedDistance(at({ distance: 1440, speed: 0 }), START + 5000)).toBeCloseTo(1440, 6)
  })

  it('stops guessing once an update goes stale', () => {
    // A player who closed their laptop must not coast to the horizon.
    const p = at({ distance: 3600, speed: MAX_MPH })
    const capped = projectedDistance(p, START + MAX_EXTRAPOLATION_MS)
    const wayLater = projectedDistance(p, START + MAX_EXTRAPOLATION_MS * 20)
    expect(wayLater).toBeCloseTo(capped, 6)
  })

  it('does not second-guess a position against the race clock', () => {
    // Deliberate: clamping here would need this machine and the publisher's to
    // agree when the race began, and they don't — a few seconds of skew between
    // two laptops would drag a legitimate racer backwards. Absurd values are
    // rejected on the way in instead (see 'rejects a distance no race could
    // produce'), which needs no shared clock.
    const far = at({ distance: 5000, speed: 0 })
    expect(projectedDistance(far, START + 1000)).toBeCloseTo(5000, 6)
  })

  it('bounds how far a single guess can carry someone', () => {
    // Whatever the skew, one stale update can only ever add this much.
    const p = at({ distance: 0, speed: MAX_MPH })
    const most = projectedDistance(p, START + MAX_EXTRAPOLATION_MS * 100)
    expect(most).toBeCloseTo(maxDistanceBy(MAX_EXTRAPOLATION_MS), 6)
  })

  it('freezes a finished racer where they crossed', () => {
    const done = at({ distance: 3240, speed: MAX_MPH, finished: true })
    expect(projectedDistance(done, START + 5000)).toBeCloseTo(3240, 6)
  })

  it('never goes negative on a clock that ran backwards', () => {
    expect(projectedDistance(at({ distance: 720 }), START - 5000)).toBeGreaterThanOrEqual(0)
  })
})

describe('standings', () => {
  const field = (): RacerProgress[] => [
    at({ uid: 'slow', distance: 720, speed: 0 }),
    at({ uid: 'fast', distance: 2880, speed: 0 }),
    at({ uid: 'mid', distance: 1800, speed: 0 }),
  ]

  it('puts the leader first', () => {
    const s = standings(field(), START)
    expect(s.map((r) => r.uid)).toEqual(['fast', 'mid', 'slow'])
    expect(s.map((r) => r.place)).toEqual([1, 2, 3])
  })

  it('gives every client the same order on a tie', () => {
    const tied: RacerProgress[] = [
      at({ uid: 'zoe', distance: 1800, speed: 0 }),
      at({ uid: 'abe', distance: 1800, speed: 0 }),
    ]
    // Same input in the other order must still rank identically.
    expect(standings(tied, START).map((r) => r.uid))
      .toEqual(standings([...tied].reverse(), START).map((r) => r.uid))
  })

  it('ranks by where people are NOW, not where they last reported', () => {
    // 'behind' reported less distance but is moving; 'ahead' has stopped.
    const s = standings([
      at({ uid: 'ahead', distance: 1800, speed: 0 }),
      at({ uid: 'behind', distance: 1764, speed: MAX_MPH }),
    ], START + 5000)
    expect(s[0].uid).toBe('behind')
  })

  it('reports a fraction of the track for the progress bar', () => {
    const s = standings([at({ distance: 0, speed: 0 })], START)
    expect(s[0].fraction).toBe(0)
    expect(s[0].fraction).toBeGreaterThanOrEqual(0)
    expect(s[0].fraction).toBeLessThanOrEqual(1)
  })

  it('flags a racer we have stopped hearing from', () => {
    const s = standings([at({ atMs: START - MAX_EXTRAPOLATION_MS - 1 })], START)
    expect(s[0].stale).toBe(true)
  })

  it('does not call a finished racer stale', () => {
    const s = standings([at({ atMs: START - 60_000, finished: true })], START)
    expect(s[0].stale).toBe(false)
  })

  it('is empty-safe', () => {
    expect(standings([], START)).toEqual([])
  })
})

describe('the race clock', () => {
  it('ends when time runs out', () => {
    expect(raceIsOver([at()], START + RACE_SECONDS * 1000, START)).toBe(true)
    expect(raceIsOver([at()], START + 1000, START)).toBe(false)
  })

  it('ends early once everybody is home', () => {
    expect(raceIsOver([at({ finished: true }), at({ uid: 'b', finished: true })], START + 1000, START)).toBe(true)
  })

  it('keeps going while anyone is still racing', () => {
    expect(raceIsOver([at({ finished: true }), at({ uid: 'b' })], START + 1000, START)).toBe(false)
  })

  it('does not end an empty race early', () => {
    expect(raceIsOver([], START + 1000, START)).toBe(false)
  })

  it('counts down and floors at zero', () => {
    expect(secondsLeft(START, START)).toBe(RACE_SECONDS)
    expect(secondsLeft(START + 1000, START)).toBe(RACE_SECONDS - 1)
    expect(secondsLeft(START + RACE_SECONDS * 2000, START)).toBe(0)
  })
})

describe('when to publish', () => {
  it('always publishes the first position', () => {
    expect(shouldPublish(null, 20, START, false)).toBe(true)
  })
  it('publishes an answer immediately, since it changes speed', () => {
    expect(shouldPublish(at(), 20, START, true)).toBe(true)
  })
  it('publishes a speed change', () => {
    expect(shouldPublish(at({ speed: 20 }), 22, START, false)).toBe(true)
  })
  it('stays quiet between heartbeats when nothing changed', () => {
    expect(shouldPublish(at({ speed: 20 }), 20, START + HEARTBEAT_MS - 1, false)).toBe(false)
  })
  it('heartbeats so rivals keep guessing from something recent', () => {
    expect(shouldPublish(at({ speed: 20 }), 20, START + HEARTBEAT_MS, false)).toBe(true)
  })
})

describe('reading another client document', () => {
  it('round-trips a real position', () => {
    const p = at({ distance: 4500, speed: 18, finished: true })
    expect(toRacerProgress('a', racerProgressData(p))).toEqual(p)
  })

  it('rejects rubbish', () => {
    expect(toRacerProgress('a', null)).toBeNull()
    expect(toRacerProgress('a', 'nope')).toBeNull()
    expect(toRacerProgress('a', {})).toBeNull()
  })

  it('rejects a distance no race could produce', () => {
    expect(toRacerProgress('a', { distance: 1e9, speed: 10, atMs: START })).toBeNull()
    expect(toRacerProgress('a', { distance: -1, speed: 10, atMs: START })).toBeNull()
  })

  it('rejects a speed above the cap', () => {
    expect(toRacerProgress('a', { distance: 0, speed: MAX_MPH + 1, atMs: START })).toBeNull()
    expect(toRacerProgress('a', { distance: 0, speed: -5, atMs: START })).toBeNull()
  })

  it('rejects NaN and Infinity rather than rendering them', () => {
    expect(toRacerProgress('a', { distance: NaN, speed: 10, atMs: START })).toBeNull()
    expect(toRacerProgress('a', { distance: 1, speed: Infinity, atMs: START })).toBeNull()
  })

  it('treats a missing finished flag as still racing', () => {
    expect(toRacerProgress('a', { distance: 1, speed: 10, atMs: START })?.finished).toBe(false)
  })

  it('writes no undefined, which Firestore refuses', () => {
    expect(JSON.stringify(racerProgressData(at()))).not.toContain('undefined')
  })
})

// The seam this file used to leave untested, and where the bug actually lived.
//
// Every test above could pass with the online layer on a completely different
// scale from the race it reports on — and for a long time it was: the simulation
// accumulated mph × SECONDS while this module read the same number as miles.
// 3600× out. Nothing caught it because nothing here ever fed real simulation
// output through toRacerProgress, so online races ran with every rival's car
// frozen on the start line, their positions silently rejected as malformed.
//
// These tests bind the two together. If anyone changes the unit on either side,
// these fail.
describe('agreeing with the race it is reporting on', () => {
  it('accepts the position a whole race at the cap actually produces', () => {
    // Drive the real integrator, exactly as RacerOnline does, for a full race.
    let distance = 0
    for (let s = 0; s < RACE_SECONDS; s++) distance = advanceDistance(distance, MAX_MPH, 1)
    expect(distance).toBeCloseTo(FULL_RACE, 6)
    // The bug: this returned null, because 5400 read as miles is absurd.
    const read = toRacerProgress('a', { distance, speed: MAX_MPH, atMs: START, finished: false })
    expect(read).not.toBeNull()
    expect(read?.distance).toBeCloseTo(FULL_RACE, 6)
  })

  it('accepts a position from every second of a race, not just the first', () => {
    // The old bound rejected everything past ~1.5; the rules bound past ~10.
    for (const secs of [1, 10, 60, 120, RACE_SECONDS]) {
      const distance = advanceDistance(0, MAX_MPH, secs)
      expect(toRacerProgress('a', { distance, speed: MAX_MPH, atMs: START })).not.toBeNull()
    }
  })

  it('dead-reckons at the same rate the simulation drives', () => {
    // A rival guessed forward two seconds must land where the simulation would
    // have put them. This is the assertion that pins both layers to one unit.
    const speed = 24
    const start = 1800
    const simulated = advanceDistance(start, speed, 2)
    const guessed = projectedDistance(at({ distance: start, speed }), START + 2000)
    expect(guessed).toBeCloseTo(simulated, 6)
  })

  it('fills the progress bar over a race rather than leaving it pinned at zero', () => {
    // With the units mismatched, a mid-race car reported a fraction of ~0.0003.
    const half = advanceDistance(0, MAX_MPH, RACE_SECONDS / 2)
    expect(standings([at({ distance: half, speed: 0 })], START)[0].fraction).toBeCloseTo(0.5, 6)
    expect(standings([at({ distance: FULL_RACE, speed: 0 })], START)[0].fraction).toBe(1)
  })
})
