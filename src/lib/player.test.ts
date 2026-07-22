import { describe, it, expect } from 'vitest'
import { isStreakAtRisk, prevDay } from './player'

describe('prevDay', () => {
  it('returns the previous calendar day', () => {
    expect(prevDay('2026-07-21')).toBe('2026-07-20')
  })
  it('rolls back across month boundaries', () => {
    expect(prevDay('2026-08-01')).toBe('2026-07-31')
  })
})

describe('isStreakAtRisk', () => {
  it('is at risk when the last play was yesterday and today is unplayed', () => {
    expect(isStreakAtRisk('2026-07-20', '2026-07-21')).toBe(true)
  })
  it('is not at risk when already played today', () => {
    expect(isStreakAtRisk('2026-07-21', '2026-07-21')).toBe(false)
  })
  it('is not at risk when the streak is already broken (a day was skipped)', () => {
    expect(isStreakAtRisk('2026-07-19', '2026-07-21')).toBe(false)
  })
  it('is not at risk with no history', () => {
    expect(isStreakAtRisk('', '2026-07-21')).toBe(false)
  })
})
