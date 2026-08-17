import { describe, it, expect } from 'vitest'
import {
  msLeft, isExpired, formatLeft, liveInvites, fromMatch, fromRoom, collectInvites,
  INVITE_TTL_MS, TOAST_MS, type GameInvite,
} from './invites'
import type { Match } from './social'
import type { LsRoom } from './lsroom'

const ME = 'me-uid'
const FRIEND = 'friend-uid'
const T0 = 1_000_000

const invite = (over: Partial<GameInvite> = {}): GameInvite => ({
  id: 'i1', kind: 'battleship', gameName: 'Battleship',
  fromUid: FRIEND, invitedAtMs: T0, route: '/x', ...over,
})

const match = (over: Partial<Match> = {}): Match => ({
  id: 'm1',
  players: [FRIEND, ME],
  emails: {},
  status: 'invite',
  turn: FRIEND,
  winner: null,
  endReason: null,
  sel: {},
  ready: {},
  createdAtMs: T0,
  updatedAtMs: T0,
  ...over,
})

const room = (over: Partial<LsRoom> = {}): LsRoom => ({
  id: 'r1',
  host: FRIEND,
  members: [FRIEND],
  invited: [ME],
  names: {},
  status: 'lobby',
  sel: { courseId: 'c', unitId: 'u', subunitId: 's', difficulty: 'easy' },
  seed: 1,
  seatUids: [],
  state: {} as LsRoom['state'],
  tick: 0,
  turnStartedAtMs: 0,
  createdAtMs: T0,
  updatedAtMs: T0,
  ...over,
})

describe('expiry', () => {
  it('gives an invite the full window when it arrives', () => {
    expect(msLeft(invite(), T0)).toBe(INVITE_TTL_MS)
    expect(isExpired(invite(), T0)).toBe(false)
  })
  it('counts down', () => {
    expect(msLeft(invite(), T0 + 60_000)).toBe(INVITE_TTL_MS - 60_000)
  })
  it('expires exactly at the deadline, not after it', () => {
    expect(isExpired(invite(), T0 + INVITE_TTL_MS - 1)).toBe(false)
    expect(isExpired(invite(), T0 + INVITE_TTL_MS)).toBe(true)
  })
  it('never reports negative time on an old invite', () => {
    expect(msLeft(invite(), T0 + INVITE_TTL_MS * 10)).toBe(0)
  })
  it('outlives the pop-up by a wide margin', () => {
    // the banner is an interruption; the Friends entry is the record
    expect(TOAST_MS).toBeLessThan(INVITE_TTL_MS)
  })
})

describe('formatLeft', () => {
  it('reads as minutes and padded seconds', () => {
    expect(formatLeft(180_000)).toBe('3:00')
    expect(formatLeft(65_000)).toBe('1:05')
    expect(formatLeft(9_000)).toBe('0:09')
  })
  it('rounds up, so a live invite never shows 0:00', () => {
    expect(formatLeft(1)).toBe('0:01')
    expect(formatLeft(0)).toBe('0:00')
  })
})

describe('liveInvites', () => {
  it('drops expired ones and keeps the rest newest first', () => {
    const fresh = invite({ id: 'fresh', invitedAtMs: T0 + 1000 })
    const older = invite({ id: 'older', invitedAtMs: T0 })
    const stale = invite({ id: 'stale', invitedAtMs: T0 - INVITE_TTL_MS })
    expect(liveInvites([older, stale, fresh], T0 + 2000).map((i) => i.id)).toEqual(['fresh', 'older'])
  })
  it('is empty when nothing is live', () => {
    expect(liveInvites([invite()], T0 + INVITE_TTL_MS)).toEqual([])
  })
})

describe('fromMatch', () => {
  it('reads a friend invite aimed at me', () => {
    const i = fromMatch(match(), ME)
    expect(i).toMatchObject({ kind: 'battleship', gameName: 'Battleship', fromUid: FRIEND, invitedAtMs: T0 })
    expect(i?.route).toBe('/battleship/pvp/m1')
  })
  it('ignores an invite I sent', () => {
    expect(fromMatch(match({ players: [ME, FRIEND] }), ME)).toBeNull()
  })
  it('ignores a match that is already under way', () => {
    expect(fromMatch(match({ status: 'placing' }), ME)).toBeNull()
    expect(fromMatch(match({ status: 'active' }), ME)).toBeNull()
    expect(fromMatch(match({ status: 'done' }), ME)).toBeNull()
  })
  it('ignores a match I am not part of', () => {
    expect(fromMatch(match({ players: [FRIEND, 'someone-else'] }), ME)).toBeNull()
  })
})

describe('fromRoom', () => {
  it('reads a table invite aimed at me', () => {
    const i = fromRoom(room(), ME)
    expect(i).toMatchObject({ kind: 'laststanding', gameName: 'Last Standing', fromUid: FRIEND })
    expect(i?.route).toBe('/laststanding/room/r1')
  })
  it('ignores a room I already joined', () => {
    expect(fromRoom(room({ invited: [], members: [FRIEND, ME] }), ME)).toBeNull()
  })
  it('ignores a table that already started', () => {
    expect(fromRoom(room({ status: 'active' }), ME)).toBeNull()
  })
  it('dates the invite from the last lobby change', () => {
    expect(fromRoom(room({ updatedAtMs: T0 + 5000 }), ME)?.invitedAtMs).toBe(T0 + 5000)
  })
  it('falls back to creation time before the first server stamp lands', () => {
    expect(fromRoom(room({ updatedAtMs: 0 }), ME)?.invitedAtMs).toBe(T0)
  })
})

describe('collectInvites', () => {
  it('merges both games into one list, newest first', () => {
    const list = collectInvites(
      [match({ id: 'm1', createdAtMs: T0 })],
      [room({ id: 'r1', updatedAtMs: T0 + 1000 })],
      ME, T0 + 2000,
    )
    expect(list.map((i) => i.kind)).toEqual(['laststanding', 'battleship'])
  })
  it('drops expired invites from either game', () => {
    const list = collectInvites(
      [match({ createdAtMs: T0 - INVITE_TTL_MS })],
      [room({ updatedAtMs: T0 - INVITE_TTL_MS })],
      ME, T0,
    )
    expect(list).toEqual([])
  })
  it('is empty when nothing is aimed at me', () => {
    expect(collectInvites([match({ players: [ME, FRIEND] })], [room({ invited: [] })], ME, T0)).toEqual([])
  })
})
