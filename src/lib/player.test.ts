import { describe, it, expect } from 'vitest'
import {
  isStreakAtRisk, mergePlayerState, prevDay, toPlayerState,
  accuracy, isValidCourseId, resolveCourseId, isValidAvatarColor,
  DEFAULT_COURSE_ID, AVATAR_COLORS, type PlayerState,
} from './player'

// Shared zero-state with every required field, reused across the suites below.
const empty: PlayerState = {
  coins: 0, xp: 0, streak: 0, lastPlayed: '', bests: {},
  gamesPlayed: 0, questionsAnswered: 0, questionsCorrect: 0,
}

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
  const played: PlayerState = {
    ...empty,
    coins: 120, xp: 900, streak: 4, lastPlayed: '2026-07-20',
    bests: { pinpoint: 3200, slider: 1800 },
    gamesPlayed: 12, questionsAnswered: 40, questionsCorrect: 31,
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

  it('prefers the cloud username (server-authoritative reservation)', () => {
    const local: PlayerState = { ...empty, username: 'LocalName' }
    const cloud: PlayerState = { ...empty, username: 'CloudName' }
    expect(mergePlayerState(local, cloud).username).toBe('CloudName')
  })

  it('falls back to a just-claimed local username when the cloud has none', () => {
    const local: PlayerState = { ...empty, username: 'AceRunner' }
    expect(mergePlayerState(local, empty).username).toBe('AceRunner')
  })

  it('leaves username unset when neither side has one', () => {
    expect(mergePlayerState(empty, empty).username).toBeUndefined()
  })

  it('max-merges the new numeric counters (games + answers)', () => {
    const local: PlayerState = { ...empty, gamesPlayed: 3, questionsAnswered: 10, questionsCorrect: 8 }
    const cloud: PlayerState = { ...empty, gamesPlayed: 5, questionsAnswered: 6, questionsCorrect: 9 }
    const merged = mergePlayerState(local, cloud)
    expect(merged.gamesPlayed).toBe(5)
    expect(merged.questionsAnswered).toBe(10)
    expect(merged.questionsCorrect).toBe(9)
  })

  it('prefers the cloud pref fields (course + avatar), like username', () => {
    const local: PlayerState = { ...empty, preferredCourseId: 'geometry', avatarColor: '#3df5ff' }
    const cloud: PlayerState = { ...empty, preferredCourseId: 'algebra-2', avatarColor: '#ff3df0' }
    const merged = mergePlayerState(local, cloud)
    expect(merged.preferredCourseId).toBe('algebra-2')
    expect(merged.avatarColor).toBe('#ff3df0')
  })

  it('falls back to a just-set local pref when the cloud has none', () => {
    const local: PlayerState = { ...empty, preferredCourseId: 'precalculus', avatarColor: '#3dffa2' }
    const merged = mergePlayerState(local, empty)
    expect(merged.preferredCourseId).toBe('precalculus')
    expect(merged.avatarColor).toBe('#3dffa2')
  })

  it('leaves pref fields unset when neither side has them', () => {
    const merged = mergePlayerState(empty, empty)
    expect(merged.preferredCourseId).toBeUndefined()
    expect(merged.avatarColor).toBeUndefined()
  })
})

describe('toPlayerState', () => {
  it('coerces a malformed lastPlayed to empty so it cannot outrank real dates', () => {
    // 'zzzz' would lexicographically beat every yyyy-mm-dd in mergePlayerState,
    // permanently capping the streak — it must be dropped at the boundary.
    const cloud = toPlayerState({ coins: 10, xp: 20, streak: 3, lastPlayed: 'zzzz', bests: {} })
    expect(cloud.lastPlayed).toBe('')
    const local: PlayerState = { ...empty, lastPlayed: '2026-07-21' }
    expect(mergePlayerState(local, cloud).lastPlayed).toBe('2026-07-21')
  })

  it('keeps a well-formed lastPlayed', () => {
    expect(toPlayerState({ lastPlayed: '2026-07-21' }).lastPlayed).toBe('2026-07-21')
  })

  it('keeps a well-formed string username', () => {
    expect(toPlayerState({ username: 'AceRunner' }).username).toBe('AceRunner')
  })

  it('drops a non-string username', () => {
    // A malformed cloud doc must not smuggle a non-string handle into state.
    expect(toPlayerState({ username: 42 }).username).toBeUndefined()
    expect(toPlayerState({ username: { evil: true } }).username).toBeUndefined()
  })

  it('drops an empty-string username', () => {
    expect(toPlayerState({ username: '' }).username).toBeUndefined()
  })

  it('coerces non-numeric counters to 0', () => {
    const s = toPlayerState({ gamesPlayed: 'lots', questionsAnswered: null, questionsCorrect: NaN })
    expect(s.gamesPlayed).toBe(0)
    expect(s.questionsAnswered).toBe(0)
    expect(s.questionsCorrect).toBe(0)
  })

  it('keeps well-formed numeric counters', () => {
    const s = toPlayerState({ gamesPlayed: 7, questionsAnswered: 20, questionsCorrect: 14 })
    expect(s.gamesPlayed).toBe(7)
    expect(s.questionsAnswered).toBe(20)
    expect(s.questionsCorrect).toBe(14)
  })

  it('keeps a valid preferredCourseId and avatarColor', () => {
    const s = toPlayerState({ preferredCourseId: 'geometry', avatarColor: '#a24bff' })
    expect(s.preferredCourseId).toBe('geometry')
    expect(s.avatarColor).toBe('#a24bff')
  })

  it('drops an unknown course id and an off-palette avatar color', () => {
    const s = toPlayerState({ preferredCourseId: 'underwater-basket-weaving', avatarColor: '#123456' })
    expect(s.preferredCourseId).toBeUndefined()
    expect(s.avatarColor).toBeUndefined()
  })

  it('drops non-string prefs', () => {
    const s = toPlayerState({ preferredCourseId: 42, avatarColor: { evil: true } })
    expect(s.preferredCourseId).toBeUndefined()
    expect(s.avatarColor).toBeUndefined()
  })
})

describe('accuracy', () => {
  it('is null before anything is answered', () => {
    expect(accuracy(0, 0)).toBeNull()
  })
  it('is correct / answered', () => {
    expect(accuracy(4, 3)).toBe(0.75)
    expect(accuracy(10, 10)).toBe(1)
    expect(accuracy(5, 0)).toBe(0)
  })
})

describe('course + avatar validation', () => {
  it('recognizes the four known courses', () => {
    expect(isValidCourseId('algebra-1')).toBe(true)
    expect(isValidCourseId('geometry')).toBe(true)
    expect(isValidCourseId('nope')).toBe(false)
  })
  it('resolves an absent/invalid course to Algebra 1', () => {
    expect(resolveCourseId(undefined)).toBe(DEFAULT_COURSE_ID)
    expect(resolveCourseId('nope')).toBe(DEFAULT_COURSE_ID)
    expect(resolveCourseId('precalculus')).toBe('precalculus')
  })
  it('accepts only palette avatar colors', () => {
    expect(isValidAvatarColor(AVATAR_COLORS[0])).toBe(true)
    expect(isValidAvatarColor('#000000')).toBe(false)
    expect(isValidAvatarColor('3df5ff')).toBe(false)
  })
})
