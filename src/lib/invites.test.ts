import { describe, it, expect } from 'vitest'
import {
  msLeft, isExpired, formatLeft, liveInvites, fromMatch, fromRoom, fromGameRoom, collectInvites,
  INVITE_TTL_MS, TOAST_MS, type GameInvite,
} from './invites'
import type { Match } from './social'
import type { LsRoom } from './lsroom'
import type { GameRoom } from './gameroom'

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

const gameRoom = (over: Partial<GameRoom> = {}): GameRoom => ({
  id: 'g1',
  game: 'ascend',
  host: FRIEND,
  members: [FRIEND],
  invited: [ME],
  names: {},
  status: 'lobby',
  sel: { courseId: 'c', unitId: 'u', subunitId: 's', difficulty: 'easy' },
  seed: 1,
  seatUids: [FRIEND],
  state: null,
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

describe('fromGameRoom', () => {
  it('reads a shared-table invite aimed at me', () => {
    const i = fromGameRoom(gameRoom(), ME)
    expect(i).toMatchObject({ kind: 'ascend', gameName: 'Ascend', fromUid: FRIEND })
    expect(i?.route).toBe('/ascend/room/g1')
  })
  it('names the Card Game properly', () => {
    expect(fromGameRoom(gameRoom({ game: 'cardgame' }), ME)?.gameName).toBe('Card Game')
    expect(fromGameRoom(gameRoom({ game: 'cardgame' }), ME)?.route).toBe('/cardgame/room/g1')
  })
  it('ignores a table I already joined', () => {
    expect(fromGameRoom(gameRoom({ invited: [], members: [FRIEND, ME] }), ME)).toBeNull()
  })
  it('ignores a table that already started', () => {
    expect(fromGameRoom(gameRoom({ status: 'active' }), ME)).toBeNull()
  })
})

describe('collectInvites', () => {
  it('merges every game into one list, newest first', () => {
    const list = collectInvites(
      [match({ id: 'm1', createdAtMs: T0 })],
      [room({ id: 'r1', updatedAtMs: T0 + 1000 })],
      [gameRoom({ id: 'g1', updatedAtMs: T0 + 2000 })],
      ME, T0 + 3000,
    )
    expect(list.map((i) => i.kind)).toEqual(['ascend', 'laststanding', 'battleship'])
  })
  it('drops expired invites from any game', () => {
    const list = collectInvites(
      [match({ createdAtMs: T0 - INVITE_TTL_MS })],
      [room({ updatedAtMs: T0 - INVITE_TTL_MS })],
      [gameRoom({ updatedAtMs: T0 - INVITE_TTL_MS })],
      ME, T0,
    )
    expect(list).toEqual([])
  })
  it('is empty when nothing is aimed at me', () => {
    expect(collectInvites(
      [match({ players: [ME, FRIEND] })], [room({ invited: [] })], [gameRoom({ invited: [] })], ME, T0,
    )).toEqual([])
  })
  it('copes with the shared tables being unavailable', () => {
    // The gameRooms rules may not be published yet, in which case that feed
    // stays empty — the other invites must still come through.
    const list = collectInvites([match()], [], [], ME, T0)
    expect(list.map((i) => i.kind)).toEqual(['battleship'])
  })
})
