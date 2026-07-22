import { describe, it, expect } from 'vitest'
import {
  friendshipId, normalizeEmail, opponentOf,
  toFriendRequest, toFriendship, toQueueEntry, toMatch, toShot, toStoredMatch,
  adjudicateShot, fleetWithHits, shotMarks, sortShots,
  type Match, type Shot,
} from './social'
import type { Ship } from './battleship'

const ts = (ms: number) => ({ toMillis: () => ms })

describe('friendshipId', () => {
  it('is order-independent and joins the sorted uids with _', () => {
    expect(friendshipId('bob', 'alice')).toBe('alice_bob')
    expect(friendshipId('alice', 'bob')).toBe('alice_bob')
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeEmail('  Player@Example.COM ')).toBe('player@example.com')
  })
  it('rejects implausible addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
    expect(normalizeEmail('a b@c.com')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })
})

describe('toFriendRequest', () => {
  const valid = { fromUid: 'u1', fromEmail: 'a@b.com', toEmail: 'c@d.com', status: 'pending', createdAt: ts(5) }
  it('accepts a well-formed doc', () => {
    expect(toFriendRequest('r1', valid)).toEqual({
      id: 'r1', fromUid: 'u1', fromEmail: 'a@b.com', toEmail: 'c@d.com', status: 'pending', createdAtMs: 5,
    })
  })
  it('rejects malformed docs', () => {
    expect(toFriendRequest('r1', null)).toBeNull()
    expect(toFriendRequest('r1', { ...valid, status: 'hacked' })).toBeNull()
    expect(toFriendRequest('r1', { ...valid, fromUid: 7 })).toBeNull()
    expect(toFriendRequest('r1', { ...valid, toEmail: undefined })).toBeNull()
  })
})

describe('toFriendship', () => {
  it('accepts a well-formed doc and rejects bad uid/email arrays', () => {
    const f = toFriendship('a_b', { uids: ['a', 'b'], emails: ['a@x.com', 'b@x.com'], createdAt: ts(1) })
    expect(f).toEqual({ id: 'a_b', uids: ['a', 'b'], emails: ['a@x.com', 'b@x.com'], createdAtMs: 1 })
    expect(toFriendship('a_b', { uids: ['a'], emails: ['a@x.com', 'b@x.com'] })).toBeNull()
    expect(toFriendship('a_b', { uids: ['a', 2], emails: ['a@x.com', 'b@x.com'] })).toBeNull()
    expect(toFriendship('a_b', 'nope')).toBeNull()
  })
})

describe('toQueueEntry', () => {
  it('requires the doc id to match the uid field', () => {
    expect(toQueueEntry('u1', { uid: 'u1', email: 'a@b.com', createdAt: ts(2) }))
      .toEqual({ uid: 'u1', email: 'a@b.com', createdAtMs: 2 })
    expect(toQueueEntry('u1', { uid: 'u2', email: 'a@b.com' })).toBeNull()
    expect(toQueueEntry('u1', { uid: 'u1' })).toBeNull()
  })
})

describe('toMatch', () => {
  const valid = {
    players: ['a', 'b'], emails: { a: 'a@x.com', b: 'b@x.com' },
    status: 'active', turn: 'a', winner: null, endReason: null,
    courseId: 'algebra-1', ready: { a: true, b: true },
    createdAt: ts(10), updatedAt: ts(20),
  }
  it('accepts a well-formed doc', () => {
    const m = toMatch('m1', valid)
    expect(m).not.toBeNull()
    expect(m!.players).toEqual(['a', 'b'])
    expect(m!.status).toBe('active')
    expect(m!.winner).toBeNull()
    expect(m!.updatedAtMs).toBe(20)
  })
  it('treats a missing winner/endReason as null and drops junk email/ready entries', () => {
    const m = toMatch('m1', { ...valid, winner: undefined, endReason: 'bogus', emails: { a: 'a@x.com', b: 9 }, ready: { a: 'yes' } })
    expect(m!.winner).toBeNull()
    expect(m!.endReason).toBeNull()
    expect(m!.emails).toEqual({ a: 'a@x.com' })
    expect(m!.ready).toEqual({})
  })
  it('rejects malformed docs', () => {
    expect(toMatch('m1', { ...valid, players: ['a'] })).toBeNull()
    expect(toMatch('m1', { ...valid, players: ['a', 'b', 'c'] })).toBeNull()
    expect(toMatch('m1', { ...valid, status: 'paused' })).toBeNull()
    expect(toMatch('m1', { ...valid, turn: 3 })).toBeNull()
    expect(toMatch('m1', { ...valid, courseId: undefined })).toBeNull()
  })
})

describe('opponentOf', () => {
  const m = toMatch('m1', {
    players: ['a', 'b'], emails: {}, status: 'active', turn: 'a', courseId: 'c', ready: {},
  }) as Match
  it('returns the other player, or null for a non-participant', () => {
    expect(opponentOf(m, 'a')).toBe('b')
    expect(opponentOf(m, 'b')).toBe('a')
    expect(opponentOf(m, 'z')).toBeNull()
  })
})

describe('toShot', () => {
  const valid = { by: 'a', r: 3, c: 4, seq: 0, result: 'pending', createdAt: ts(1) }
  it('accepts a well-formed doc', () => {
    expect(toShot('s1', valid)).toEqual({ id: 's1', by: 'a', r: 3, c: 4, seq: 0, result: 'pending', createdAtMs: 1 })
  })
  it('rejects out-of-range coordinates and bad results', () => {
    expect(toShot('s1', { ...valid, r: 8 })).toBeNull()
    expect(toShot('s1', { ...valid, c: -1 })).toBeNull()
    expect(toShot('s1', { ...valid, r: 1.5 })).toBeNull()
    expect(toShot('s1', { ...valid, result: 'kaboom' })).toBeNull()
    expect(toShot('s1', { ...valid, by: undefined })).toBeNull()
    expect(toShot('s1', { ...valid, seq: NaN })).toBeNull()
  })
})

describe('toStoredMatch', () => {
  const fleet = [{ id: 'destroyer-1', size: 2, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] }]
  it('accepts a stored fleet and zeroes hits', () => {
    const sm = toStoredMatch({ fleet, subunitId: 'one-step' })
    expect(sm).not.toBeNull()
    expect(sm!.fleet[0].hits).toBe(0)
    expect(sm!.subunitId).toBe('one-step')
  })
  it('defaults subunitId and rejects malformed fleets', () => {
    const sm = toStoredMatch({ fleet })
    expect(sm!.subunitId).toBeNull()
    expect(toStoredMatch({ fleet: [] })).toBeNull()
    expect(toStoredMatch({ fleet: [{ id: 'x', size: 2, cells: [{ r: 0, c: 0 }] }] })).toBeNull() // size/cells mismatch
    expect(toStoredMatch({ fleet: [{ id: 'x', size: 1, cells: [{ r: 9, c: 0 }] }] })).toBeNull() // off-board
    expect(toStoredMatch('junk')).toBeNull()
  })
})

// ----- adjudication -----

const twoShips: Ship[] = [
  { id: 'destroyer-1', size: 2, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }], hits: 0 },
  { id: 'patrol', size: 2, cells: [{ r: 4, c: 4 }, { r: 4, c: 5 }], hits: 0 },
]

describe('adjudicateShot', () => {
  it('maps open water to miss', () => {
    const { result, fleetSunk } = adjudicateShot(twoShips, 7, 7)
    expect(result).toBe('miss')
    expect(fleetSunk).toBe(false)
  })
  it('maps a first hit to hit and the final cell to sunk', () => {
    const first = adjudicateShot(twoShips, 0, 0)
    expect(first.result).toBe('hit')
    const second = adjudicateShot(first.fleet, 0, 1)
    expect(second.result).toBe('sunk')
    expect(second.fleetSunk).toBe(false) // the patrol boat survives
  })
  it('reports fleetSunk when the last ship goes down', () => {
    let fleet = twoShips
    for (const [r, c] of [[0, 0], [0, 1], [4, 4]] as const) fleet = adjudicateShot(fleet, r, c).fleet
    const final = adjudicateShot(fleet, 4, 5)
    expect(final.result).toBe('sunk')
    expect(final.fleetSunk).toBe(true)
  })
  it('does not mutate the input fleet', () => {
    adjudicateShot(twoShips, 0, 0)
    expect(twoShips[0].hits).toBe(0)
  })
})

const shot = (over: Partial<Shot>): Shot => ({
  id: 'x', by: 'a', r: 0, c: 0, seq: 0, result: 'miss', createdAtMs: 0, ...over,
})

describe('fleetWithHits', () => {
  it('re-derives hit counts from adjudicated shots only', () => {
    const shots = [
      shot({ id: '1', r: 0, c: 0, result: 'hit' }),
      shot({ id: '2', r: 0, c: 1, result: 'pending' }), // not yet adjudicated — no hit
      shot({ id: '3', r: 7, c: 7, result: 'miss' }),
    ]
    const fleet = fleetWithHits(twoShips, shots)
    expect(fleet[0].hits).toBe(1)
    expect(fleet[1].hits).toBe(0)
  })
})

describe('shotMarks', () => {
  it('maps hit/sunk to hit, miss to miss, and skips pending', () => {
    const marks = shotMarks([
      shot({ id: '1', r: 0, c: 0, result: 'hit' }),
      shot({ id: '2', r: 0, c: 1, result: 'sunk' }),
      shot({ id: '3', r: 1, c: 0, result: 'miss' }),
      shot({ id: '4', r: 2, c: 2, result: 'pending' }),
    ])
    expect(marks).toEqual({ '0,0': 'hit', '0,1': 'hit', '1,0': 'miss' })
  })
})

describe('sortShots', () => {
  it('orders by seq, then server time, without mutating the input', () => {
    const input = [
      shot({ id: 'b', seq: 1, createdAtMs: 5 }),
      shot({ id: 'a', seq: 0, createdAtMs: 9 }),
      shot({ id: 'c', seq: 1, createdAtMs: 2 }),
    ]
    const sorted = sortShots(input)
    expect(sorted.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(input.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
})
