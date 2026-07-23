import { describe, it, expect } from 'vitest'
import {
  applyAnswer, advanceDistance, trackFraction, stepAi, stepRace, rank, placementOf,
  ordinal, aiTuningsFor, initialCooldown, raceScore,
  MAX_MPH, MIN_MPH, START_MPH, SPEED_STEP, RACE_SECONDS, AI_GRACE_MIN,
  type AiCar, type PlayerCar, type Car,
} from './racer'

// A tiny deterministic rng: returns each value in `seq`, then repeats the last.
function seqRng(...seq: number[]): () => number {
  let i = 0
  return () => seq[Math.min(i++, seq.length - 1)]
}

const player = (over: Partial<PlayerCar> = {}): PlayerCar => ({
  kind: 'player', id: 'you', name: 'YOU', color: '#4d8dff', speed: START_MPH, distance: 0, ...over,
})
const ai = (over: Partial<AiCar> = {}): AiCar => ({
  kind: 'ai', id: 'ai-1', name: 'NOVA', color: '#ff3df0', speed: START_MPH, distance: 0,
  correctRate: 0.8, cadenceMin: 2, cadenceMax: 3, cooldown: 2.5, ...over,
})

describe('applyAnswer', () => {
  it('adds on correct and subtracts on wrong', () => {
    expect(applyAnswer(10, true)).toBe(10 + SPEED_STEP)
    expect(applyAnswer(10, false)).toBe(10 - SPEED_STEP)
  })
  it('floors at 0 — a stopped car cannot go negative', () => {
    expect(applyAnswer(0, false)).toBe(MIN_MPH)
    expect(applyAnswer(1, false)).toBe(0) // 1 - 2 clamps to 0, not -1
  })
  it('caps at MAX_MPH so nobody runs away', () => {
    expect(applyAnswer(MAX_MPH, true)).toBe(MAX_MPH)
    expect(applyAnswer(MAX_MPH - 1, true)).toBe(MAX_MPH)
  })
})

describe('advanceDistance', () => {
  it('integrates distance continuously from speed × dt', () => {
    expect(advanceDistance(0, 30, 1)).toBe(30)
    expect(advanceDistance(100, 20, 0.5)).toBe(110)
  })
  it('a stopped car does not move', () => {
    expect(advanceDistance(42, 0, 1)).toBe(42)
  })
})

describe('trackFraction', () => {
  it('is 0 at the start and clamps to [0,1]', () => {
    expect(trackFraction(0)).toBe(0)
    expect(trackFraction(-5)).toBe(0)
    expect(trackFraction(RACE_SECONDS * MAX_MPH * 2)).toBe(1)
  })
  it('reaches 1 exactly at the theoretical ceiling', () => {
    expect(trackFraction(RACE_SECONDS * MAX_MPH)).toBe(1)
  })
})

describe('stepAi', () => {
  it('only counts the cooldown down while it is still armed', () => {
    const before = ai({ cooldown: 2, speed: 10 })
    const after = stepAi(before, 0.5, seqRng(0))
    expect(after.cooldown).toBeCloseTo(1.5)
    expect(after.speed).toBe(10) // no answer fired
  })
  it('fires a CORRECT answer (rng < correctRate) → speed up + re-armed cadence', () => {
    const before = ai({ cooldown: 0.1, speed: 10, correctRate: 0.8, cadenceMin: 2, cadenceMax: 4 })
    const after = stepAi(before, 0.2, seqRng(0.1, 0.5)) // 0.1<0.8 correct; cadence = 2 + 0.5*(4-2)=3
    expect(after.speed).toBe(12)
    expect(after.cooldown).toBeCloseTo(3)
  })
  it('fires a WRONG answer (rng ≥ correctRate) → speed down', () => {
    const before = ai({ cooldown: 0, speed: 10, correctRate: 0.7 })
    const after = stepAi(before, 0.1, seqRng(0.95, 0))
    expect(after.speed).toBe(8)
  })
})

describe('stepRace', () => {
  it('cruises every car forward at its current speed each frame', () => {
    const cars: Car[] = [player({ speed: 20 }), ai({ speed: 10, cooldown: 5 })]
    const next = stepRace(cars, 1, seqRng(0))
    expect(next[0].distance).toBe(20) // player cruised
    expect(next[1].distance).toBe(10) // ai cruised, cooldown not yet fired
    expect((next[1] as AiCar).cooldown).toBeCloseTo(4)
  })
  it('does not mutate the input cars', () => {
    const cars: Car[] = [player({ speed: 20 })]
    stepRace(cars, 1, seqRng(0))
    expect(cars[0].distance).toBe(0)
  })
  it('leaves the player speed to the page (only the AI answers here)', () => {
    const cars: Car[] = [player({ speed: 20 })]
    const next = stepRace(cars, 1, seqRng(0.99))
    expect(next[0].speed).toBe(20)
  })
})

describe('rank & placementOf', () => {
  const field: Car[] = [
    player({ id: 'you', distance: 500 }),
    ai({ id: 'a', distance: 900 }),
    ai({ id: 'b', distance: 500, speed: 30 }),
    ai({ id: 'c', distance: 200 }),
  ]
  it('orders leader-first by distance', () => {
    expect(rank(field).map((c) => c.id)).toEqual(['a', 'b', 'you', 'c'])
  })
  it('breaks distance ties by speed then id (deterministic)', () => {
    // you (speed 10) vs b (speed 30) both at 500 → b ranks ahead on speed
    expect(placementOf(field, 'b')).toBe(2)
    expect(placementOf(field, 'you')).toBe(3)
  })
  it('gives the winner placement 1', () => {
    expect(placementOf(field, 'a')).toBe(1)
  })
})

describe('ordinal', () => {
  it('formats plain-text places', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(11)).toBe('11th')
  })
})

describe('aiTuningsFor', () => {
  it('fields three rivals whatever the difficulty', () => {
    expect(aiTuningsFor('medium')).toHaveLength(3)
  })
  it('nudges accuracy up on hard and down on easy', () => {
    const easy = aiTuningsFor('easy')
    const hard = aiTuningsFor('hard')
    for (let i = 0; i < 3; i++) expect(hard[i].correctRate).toBeGreaterThan(easy[i].correctRate)
  })
  it('keeps correct-rate a valid probability', () => {
    for (const t of aiTuningsFor('hard')) {
      expect(t.correctRate).toBeGreaterThanOrEqual(0)
      expect(t.correctRate).toBeLessThanOrEqual(1)
    }
  })
})

describe('initialCooldown — the opening grace', () => {
  it('never fires before the grace plus a full minimum cadence', () => {
    for (const t of aiTuningsFor('hard')) {
      expect(initialCooldown(t, seqRng(0))).toBeCloseTo(AI_GRACE_MIN + t.cadenceMin)
    }
  })
  it('holds every AI silent through the opening seconds of a race', () => {
    let cars: Car[] = aiTuningsFor('medium').map((t, i): AiCar => ({
      kind: 'ai', id: `ai-${i}`, name: `AI${i}`, color: '#fff', speed: START_MPH, distance: 0,
      correctRate: t.correctRate, cadenceMin: t.cadenceMin, cadenceMax: t.cadenceMax,
      cooldown: initialCooldown(t, seqRng(0)), // the earliest possible first answer
    }))
    for (let t = 0; t < AI_GRACE_MIN; t += 0.1) cars = stepRace(cars, 0.1, seqRng(0.99))
    for (const c of cars) expect(c.speed).toBe(START_MPH) // nobody has answered yet
  })
})

// ---- fairness: a deterministic full-race drive ----------------------------
// The whole point of the tuning: a reasonably accurate human beats the field
// with effort. Simulated with a seeded rng so the check is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Run a full race: the player answers every `period`s at `accuracy`. Returns
 * the final field plus the peak speed any AI reached in the opening 30s (the
 * no-early-surge probe — `ai-0` is always the pace-setter, the top baseline).
 */
function driveRace(
  seed: number,
  period: number,
  accuracy: number,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
): { cars: Car[]; peakEarlyAiMph: number } {
  const rng = mulberry32(seed)
  let cars: Car[] = [
    { kind: 'player', id: 'you', name: 'YOU', color: '#4d8dff', speed: START_MPH, distance: 0 },
    ...aiTuningsFor(difficulty).map((t, i): AiCar => ({
      kind: 'ai', id: `ai-${i}`, name: `AI${i}`, color: '#fff', speed: START_MPH, distance: 0,
      correctRate: t.correctRate, cadenceMin: t.cadenceMin, cadenceMax: t.cadenceMax,
      cooldown: initialCooldown(t, rng),
    })),
  ]
  const dt = 0.1
  let nextAnswer = period
  let peakEarlyAiMph = 0
  for (let t = 0; t < RACE_SECONDS; t += dt) {
    cars = stepRace(cars, dt, rng)
    if (t < 30) {
      for (const c of cars) if (c.kind === 'ai' && c.speed > peakEarlyAiMph) peakEarlyAiMph = c.speed
    }
    if (t >= nextAnswer) {
      nextAnswer += period
      cars = cars.map((c) => (c.kind === 'player' ? { ...c, speed: applyAnswer(c.speed, rng() < accuracy) } : c))
    }
  }
  return { cars, peakEarlyAiMph }
}

const carById = (cars: Car[], id: string): Car => {
  const c = cars.find((x) => x.id === id)
  if (!c) throw new Error(`no car ${id}`)
  return c
}
/** Gap from `id` back to the leader of the rest of the field (0 if `id` leads). */
const gapToLead = (cars: Car[], id: string): number => {
  const me = carById(cars, id).distance
  const lead = Math.max(...cars.filter((c) => c.id !== id).map((c) => c.distance))
  return Math.max(0, lead - me)
}
const SEEDS = 100 // a big deterministic sweep — reproducible, no flakiness

// The tuning's whole point: a GENUINE, close competition to the flag — a strong
// player wins the majority but not every time, a median player is really in the
// fight, and a careless one falls to the pace-setter. Verified over many seeds.
describe('race competitiveness (seeded Monte-Carlo)', () => {
  it('a strong human — every 5s at 85% — wins a MAJORITY but not every race', () => {
    let wins = 0
    let marginSum = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { cars } = driveRace(seed, 5, 0.85)
      if (placementOf(cars, 'you') === 1) wins++
      // signed gap to the pace-setter: how tight the duel is at the flag
      marginSum += Math.abs(carById(cars, 'you').distance - carById(cars, 'ai-0').distance)
    }
    expect(wins).toBeGreaterThanOrEqual(55) // a clear majority — effort is rewarded
    expect(wins).toBeLessThanOrEqual(85) // but NOT a walkover — the AI can win
    expect(marginSum / SEEDS).toBeLessThan(900) // decided by a close margin, not a blowout
  })

  it('the difficulty knob makes hard a real fight and easy a comfortable win', () => {
    const winsAt = (difficulty: 'easy' | 'hard'): number => {
      let wins = 0
      for (let seed = 1; seed <= SEEDS; seed++) {
        if (placementOf(driveRace(seed, 5, 0.85, difficulty).cars, 'you') === 1) wins++
      }
      return wins
    }
    const easyWins = winsAt('easy')
    const hardWins = winsAt('hard')
    expect(easyWins).toBeGreaterThan(hardWins) // harder topic = tougher rivals
    expect(hardWins).toBeGreaterThanOrEqual(45) // even a strong player really has to fight
    expect(easyWins).toBeLessThanOrEqual(95) // still not a guaranteed win
  })

  it('a median human — every 6.5s at 72% — genuinely fights for the podium', () => {
    let podiums = 0
    let wins = 0
    let gapSum = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { cars } = driveRace(seed, 6.5, 0.72)
      const place = placementOf(cars, 'you')
      if (place <= 3) podiums++
      if (place === 1) wins++
      gapSum += gapToLead(cars, 'you')
    }
    expect(podiums).toBeGreaterThanOrEqual(70) // usually on the podium — really in it
    expect(wins).toBeGreaterThanOrEqual(5) // and occasionally steals the win outright
    expect(wins).toBeLessThanOrEqual(45) // but doesn't dominate — that's the strong player's seat
    // close at the flag: on average within a small fraction of the whole track
    expect(gapSum / SEEDS).toBeLessThan(RACE_SECONDS * MAX_MPH * 0.22)
  })

  it('a careless human — every 9s at 45% — reliably loses to the pace-setter', () => {
    let beatenByPace = 0
    let wins = 0
    let carelessGapSum = 0
    let medianGapSum = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { cars } = driveRace(seed, 9, 0.45)
      if (carById(cars, 'you').distance < carById(cars, 'ai-0').distance) beatenByPace++
      if (placementOf(cars, 'you') === 1) wins++
      carelessGapSum += gapToLead(cars, 'you')
      medianGapSum += gapToLead(driveRace(seed, 6.5, 0.72).cars, 'you')
    }
    expect(beatenByPace).toBeGreaterThanOrEqual(90) // the pace-setter is a real winner
    expect(wins).toBe(0) // guessing never wins
    // the field isn't strung out for a real player: a median run is far closer
    // to the lead than a careless one — the race stays a pack, not a parade
    expect(medianGapSum).toBeLessThan(carelessGapSum)
  })

  it('holds the opening gentle: no AI is near the cap in the first 30s', () => {
    let peak = 0
    for (const [period, accuracy] of [[5, 0.85], [6.5, 0.72], [9, 0.45]] as const) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          peak = Math.max(peak, driveRace(seed, period, accuracy, difficulty).peakEarlyAiMph)
        }
      }
    }
    expect(peak).toBeLessThanOrEqual(24) // well under the 30 cap — no early surge
  })
})

describe('raceScore', () => {
  it('rewards a dominant win far above a stalled last place', () => {
    const win = raceScore(RACE_SECONDS * MAX_MPH * 0.95, 1)
    const last = raceScore(RACE_SECONDS * MAX_MPH * 0.1, 4)
    expect(win).toBeGreaterThan(last)
    expect(win).toBeGreaterThan(4000)
  })
  it('adds the podium bonus by placement', () => {
    const d = RACE_SECONDS * MAX_MPH * 0.5
    expect(raceScore(d, 1) - raceScore(d, 4)).toBe(1500) // 1st bonus over 4th
    expect(raceScore(d, 4)).toBe(Math.round(0.5 * 3000)) // 4th = distance only
  })
})
