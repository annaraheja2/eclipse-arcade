import { describe, it, expect } from 'vitest'
import { pickDailyRounds } from './games'

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
