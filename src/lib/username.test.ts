import { describe, it, expect } from 'vitest'
import { normalizeUsername, validateUsername, displayNameFor, planUsernameClaim } from './username'

describe('normalizeUsername', () => {
  it('trims and lowercases', () => {
    expect(normalizeUsername('  AceRunner  ')).toBe('acerunner')
  })
})

describe('validateUsername', () => {
  it('accepts a valid handle and returns display + lowercased forms', () => {
    const res = validateUsername('  Ace_Runner7 ')
    expect(res).toEqual({ ok: true, value: 'Ace_Runner7', lower: 'ace_runner7' })
  })

  it('accepts the minimum and maximum lengths', () => {
    expect(validateUsername('abc').ok).toBe(true)
    expect(validateUsername('a'.repeat(20)).ok).toBe(true)
  })

  it('rejects too short (reason: length)', () => {
    const res = validateUsername('ab')
    expect(res).toEqual({ ok: false, reason: 'Username must be 3–20 characters.' })
  })

  it('rejects too long (reason: length)', () => {
    const res = validateUsername('a'.repeat(21))
    expect(res).toEqual({ ok: false, reason: 'Username must be 3–20 characters.' })
  })

  it('rejects a leading digit (reason: start with a letter)', () => {
    const res = validateUsername('1player')
    expect(res).toEqual({ ok: false, reason: 'Username must start with a letter.' })
  })

  it('rejects a leading underscore (reason: start with a letter)', () => {
    const res = validateUsername('_player')
    expect(res).toEqual({ ok: false, reason: 'Username must start with a letter.' })
  })

  it('rejects disallowed characters (reason: charset)', () => {
    const res = validateUsername('ace runner')
    expect(res).toEqual({ ok: false, reason: 'Use only letters, numbers, and underscores.' })
  })

  it('rejects punctuation (reason: charset)', () => {
    const res = validateUsername('ace!')
    expect(res).toEqual({ ok: false, reason: 'Use only letters, numbers, and underscores.' })
  })

  it('rejects consecutive underscores (reason: consecutive)', () => {
    const res = validateUsername('ace__runner')
    expect(res).toEqual({ ok: false, reason: 'No two underscores in a row.' })
  })

  it('rejects a trailing underscore (reason: trailing)', () => {
    const res = validateUsername('ace_')
    expect(res).toEqual({ ok: false, reason: "Username can't end with an underscore." })
  })
})

describe('planUsernameClaim', () => {
  const uid = 'me'

  it('reserves a brand-new handle for a first-time claimer', () => {
    // No prior handle, target free: write the reservation, nothing to release.
    expect(planUsernameClaim({ uid, lower: 'ace', targetOwnerUid: null, prevLower: null, prevOwnerUid: null }))
      .toEqual({ kind: 'ok', writeReservation: true, releasePrev: null })
  })

  it('re-saving the current handle skips the reservation write (no usernames update rule)', () => {
    // The target doc exists and is ours; re-writing it would be a denied UPDATE
    // that aborts the whole transaction. Only the player mirror is refreshed.
    expect(planUsernameClaim({ uid, lower: 'ace', targetOwnerUid: uid, prevLower: 'ace', prevOwnerUid: uid }))
      .toEqual({ kind: 'ok', writeReservation: false, releasePrev: null })
  })

  it('change-then-revert-to-current is also a no-write reservation', () => {
    // Same steady state as re-save-unchanged: target owned by us, prev == target.
    expect(planUsernameClaim({ uid, lower: 'ace', targetOwnerUid: uid, prevLower: 'ace', prevOwnerUid: uid }))
      .toEqual({ kind: 'ok', writeReservation: false, releasePrev: null })
  })

  it('rejects a handle owned by someone else', () => {
    expect(planUsernameClaim({ uid, lower: 'ace', targetOwnerUid: 'other', prevLower: null, prevOwnerUid: null }))
      .toEqual({ kind: 'taken' })
  })

  it('renaming releases the prior reservation when it still exists and is ours', () => {
    expect(planUsernameClaim({ uid, lower: 'bob', targetOwnerUid: null, prevLower: 'ace', prevOwnerUid: uid }))
      .toEqual({ kind: 'ok', writeReservation: true, releasePrev: 'ace' })
  })

  it('renaming does NOT delete a diverged prior reservation (missing doc)', () => {
    // A missing prior doc (prevOwnerUid null) must not become a denied delete.
    expect(planUsernameClaim({ uid, lower: 'bob', targetOwnerUid: null, prevLower: 'ace', prevOwnerUid: null }))
      .toEqual({ kind: 'ok', writeReservation: true, releasePrev: null })
  })

  it('renaming does NOT delete a prior reservation owned by someone else', () => {
    expect(planUsernameClaim({ uid, lower: 'bob', targetOwnerUid: null, prevLower: 'ace', prevOwnerUid: 'other' }))
      .toEqual({ kind: 'ok', writeReservation: true, releasePrev: null })
  })
})

describe('displayNameFor', () => {
  it('prefers the username when set', () => {
    expect(displayNameFor('Ace', 'ace@example.com')).toBe('Ace')
  })
  it('falls back to email when there is no username', () => {
    expect(displayNameFor(undefined, 'ace@example.com')).toBe('ace@example.com')
    expect(displayNameFor('   ', 'ace@example.com')).toBe('ace@example.com')
  })
  it('falls back to a generic label when neither is present', () => {
    expect(displayNameFor(null, null)).toBe('a player')
  })
})
