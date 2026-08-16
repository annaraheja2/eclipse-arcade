import { describe, it, expect } from 'vitest'
import { pickDailyRounds, GAMES } from './games'

describe('pickDailyRounds — deterministic daily puzzle', () => {
  it('returns the requested number of rounds', () => {
    expect(pickDailyRounds('2026-07-21')).toHaveLength(5)
    expect(pickDailyRounds('2026-07-21', 3)).toHaveLength(3)
  })

  it('is deterministic: same date → identical rounds', () => {
    expect(pickDailyRounds('2026-07-21')).toEqual(pickDailyRounds('2026-07-21'))
  })

  it('differs across dates (so each day is a fresh puzzle)', () => {
    const a = pickDailyRounds('2026-07-21').map((r) => r.prompt)
    const b = pickDailyRounds('2026-07-22').map((r) => r.prompt)
    expect(a).not.toEqual(b)
  })

  it('never repeats a round within a single daily set', () => {
    const prompts = pickDailyRounds('2026-07-21').map((r) => r.prompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })
})

describe('the cabinet registry', () => {
  it('lists only real, playable games — no placeholders', () => {
    // PinPoint, Grid-Fill, Match-Up and Fit-the-Line were removed: the last
    // three never existed beyond a SOON badge, and PinPoint's aim-and-fire
    // mechanic was the category the arcade moved away from.
    const gone = ['pinpoint', 'gridfill', 'matchup', 'fitline', 'slider']
    for (const key of gone) {
      expect(GAMES.some((g) => g.key === key), `${key} is back in the lobby`).toBe(false)
    }
  })

  it('gives every cabinet a type the lobby knows how to open', () => {
    const routable = ['battleship', 'daily', 'racer', 'cardgame', 'ascend', 'laststanding']
    for (const g of GAMES) {
      expect(routable, `${g.key} has no route`).toContain(g.type)
    }
  })

  it('keeps the Daily Challenge pool alive after the cabinet cull', () => {
    // Daily still runs on the flat round model that PinPoint used, so its
    // round pools must survive even though the cabinet is gone.
    const daily = GAMES.find((g) => g.key === 'daily')
    expect(daily).toBeDefined()
    expect(pickDailyRounds('2026-08-16').length).toBeGreaterThan(0)
  })
})
