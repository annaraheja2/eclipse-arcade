import { describe, it, expect } from 'vitest'
import { isStreakAtRisk, mergePlayerState, prevDay, toPlayerState, type PlayerState } from './player'

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

describe('mergePlayerState', () => {
  const empty: PlayerState = { coins: 0, xp: 0, streak: 0, lastPlayed: '', bests: {} }
  const played: PlayerState = {
    coins: 120, xp: 900, streak: 4, lastPlayed: '2026-07-20',
    bests: { pinpoint: 3200, slider: 1800 },
  }

  it('keeps local when the cloud copy is empty (fresh account)', () => {
    expect(mergePlayerState(played, empty)).toEqual(played)
  })

  it('adopts cloud when local is empty (new device)', () => {
    expect(mergePlayerState(empty, played)).toEqual(played)
  })

  it('takes the per-game max across interleaved bests', () => {
    const local: PlayerState = { ...empty, bests: { pinpoint: 3200, daily: 900 } }
    const cloud: PlayerState = { ...empty, bests: { pinpoint: 2500, slider: 4100 } }
    expect(mergePlayerState(local, cloud).bests).toEqual({
      pinpoint: 3200, slider: 4100, daily: 900,
    })
  })

  it('takes the max of coins and xp independently', () => {
    const local: PlayerState = { ...empty, coins: 500, xp: 100 }
    const cloud: PlayerState = { ...empty, coins: 200, xp: 800 }
    const merged = mergePlayerState(local, cloud)
    expect(merged.coins).toBe(500)
    expect(merged.xp).toBe(800)
  })

  it('resolves streak/lastPlayed conflicts: max streak, later date', () => {
    const local: PlayerState = { ...empty, streak: 2, lastPlayed: '2026-07-21' }
    const cloud: PlayerState = { ...empty, streak: 9, lastPlayed: '2026-07-15' }
    const merged = mergePlayerState(local, cloud)
    expect(merged.streak).toBe(9)
    expect(merged.lastPlayed).toBe('2026-07-21')
  })

  it('treats an empty lastPlayed as earliest', () => {
    expect(mergePlayerState({ ...empty }, { ...empty, lastPlayed: '2026-07-01' }).lastPlayed)
      .toBe('2026-07-01')
  })

  it('does not mutate its inputs', () => {
    const local = { ...played, bests: { ...played.bests } }
    const cloud: PlayerState = { ...empty, bests: { pinpoint: 9999 } }
    mergePlayerState(local, cloud)
    expect(local.bests).toEqual(played.bests)
    expect(cloud.bests).toEqual({ pinpoint: 9999 })
  })
})

describe('toPlayerState', () => {
  it('coerces a malformed lastPlayed to empty so it cannot outrank real dates', () => {
    // 'zzzz' would lexicographically beat every yyyy-mm-dd in mergePlayerState,
    // permanently capping the streak — it must be dropped at the boundary.
    const cloud = toPlayerState({ coins: 10, xp: 20, streak: 3, lastPlayed: 'zzzz', bests: {} })
    expect(cloud.lastPlayed).toBe('')
    const local: PlayerState = { coins: 0, xp: 0, streak: 0, lastPlayed: '2026-07-21', bests: {} }
    expect(mergePlayerState(local, cloud).lastPlayed).toBe('2026-07-21')
  })

  it('keeps a well-formed lastPlayed', () => {
    expect(toPlayerState({ lastPlayed: '2026-07-21' }).lastPlayed).toBe('2026-07-21')
  })
})
