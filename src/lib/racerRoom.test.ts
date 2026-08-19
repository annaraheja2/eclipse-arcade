import { describe, it, expect } from 'vitest'
import {
  projectedDistance, standings, raceIsOver, secondsLeft, shouldPublish,
  toRacerProgress, racerProgressData, maxDistanceBy,
  MAX_EXTRAPOLATION_MS, HEARTBEAT_MS, type RacerProgress,
} from './racerRoom'
import { MAX_MPH, RACE_SECONDS } from './racer'

const START = 1_000_000
const at = (over: Partial<RacerProgress> = {}): RacerProgress =>
  ({ uid: 'a', distance: 0, speed: 20, atMs: START, finished: false, ...over })

// Miles covered at `mph` for `ms`.
const miles = (mph: number, ms: number) => (mph * ms) / 3_600_000

describe('dead reckoning', () => {
  it('returns the published position at the moment it was published', () => {
    expect(projectedDistance(at({ distance: 0.5 }), START)).toBeCloseTo(0.5, 6)
  })

  it('carries a racer forward at their last known speed', () => {
    const p = at({ distance: 0.5, speed: 24 })
    expect(projectedDistance(p, START + 2000)).toBeCloseTo(0.5 + miles(24, 2000), 6)
  })

  it('does not move a stopped car', () => {
    expect(projectedDistance(at({ distance: 0.4, speed: 0 }), START + 5000)).toBeCloseTo(0.4, 6)
  })

  it('stops guessing once an update goes stale', () => {
    // A player who closed their laptop must not coast to the horizon.
    const p = at({ distance: 1, speed: MAX_MPH })
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
    const far = at({ distance: 1.5, speed: 0 })
    expect(projectedDistance(far, START + 1000)).toBeCloseTo(1.5, 6)
  })

  it('bounds how far a single guess can carry someone', () => {
    // Whatever the skew, one stale update can only ever add this much.
    const p = at({ distance: 0, speed: MAX_MPH })
    const most = projectedDistance(p, START + MAX_EXTRAPOLATION_MS * 100)
    expect(most).toBeCloseTo(maxDistanceBy(MAX_EXTRAPOLATION_MS), 6)
  })

  it('freezes a finished racer where they crossed', () => {
    const done = at({ distance: 0.9, speed: MAX_MPH, finished: true })
    expect(projectedDistance(done, START + 5000)).toBeCloseTo(0.9, 6)
  })

  it('never goes negative on a clock that ran backwards', () => {
    expect(projectedDistance(at({ distance: 0.2 }), START - 5000)).toBeGreaterThanOrEqual(0)
  })
})

describe('standings', () => {
  const field = (): RacerProgress[] => [
    at({ uid: 'slow', distance: 0.2, speed: 0 }),
    at({ uid: 'fast', distance: 0.8, speed: 0 }),
    at({ uid: 'mid', distance: 0.5, speed: 0 }),
  ]

  it('puts the leader first', () => {
    const s = standings(field(), START)
    expect(s.map((r) => r.uid)).toEqual(['fast', 'mid', 'slow'])
    expect(s.map((r) => r.place)).toEqual([1, 2, 3])
  })

  it('gives every client the same order on a tie', () => {
    const tied: RacerProgress[] = [
      at({ uid: 'zoe', distance: 0.5, speed: 0 }),
      at({ uid: 'abe', distance: 0.5, speed: 0 }),
    ]
    // Same input in the other order must still rank identically.
    expect(standings(tied, START).map((r) => r.uid))
      .toEqual(standings([...tied].reverse(), START).map((r) => r.uid))
  })

  it('ranks by where people are NOW, not where they last reported', () => {
    // 'behind' reported less distance but is moving; 'ahead' has stopped.
    const s = standings([
      at({ uid: 'ahead', distance: 0.50, speed: 0 }),
      at({ uid: 'behind', distance: 0.49, speed: MAX_MPH }),
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
    const p = at({ distance: 1.25, speed: 18, finished: true })
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
