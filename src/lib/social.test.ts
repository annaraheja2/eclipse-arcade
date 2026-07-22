import { describe, it, expect } from 'vitest'
import {
  friendshipId, requestId, friendRequestIdsFor, normalizeEmail, opponentOf,
  toFriendRequest, toFriendship, toQueueEntry, toMatch, toShot, toStoredMatch,
  toSelection, pickOpponent,
  adjudicateShot, fleetWithHits, shotMarks, sortShots, priorResultAt,
  type Friendship, type Match, type Shot, type QueueEntry, type Selection,
} from './social'
import type { Ship } from './battleship'

const ts = (ms: number) => ({ toMillis: () => ms })

describe('friendshipId', () => {
  it('is order-independent and joins the sorted uids with _', () => {
    expect(friendshipId('bob', 'alice')).toBe('alice_bob')
    expect(friendshipId('alice', 'bob')).toBe('alice_bob')
  })
})

describe('requestId', () => {
  it('joins the sender uid and the lowercased recipient email', () => {
    expect(requestId('u1', 'Friend@Example.COM')).toBe('u1_friend@example.com')
    expect(requestId('u1', 'friend@example.com')).toBe('u1_friend@example.com')
  })
})

describe('friendRequestIdsFor', () => {
  it('derives both directional request ids with sender/recipient crossed over', () => {
    const f = toFriendship('a_b', { uids: ['a', 'b'], emails: ['a@x.com', 'b@x.com'] }) as Friendship
    // request A->B keys on B's email; request B->A keys on A's email.
    expect(friendRequestIdsFor(f)).toEqual(['a_b@x.com', 'b_a@x.com'])
  })
  it('lowercases the recipient email (via requestId)', () => {
    const f = toFriendship('u1_u2', { uids: ['u1', 'u2'], emails: ['Alice@X.com', 'Bob@Y.com'] }) as Friendship
    expect(friendRequestIdsFor(f)).toEqual(['u1_bob@y.com', 'u2_alice@x.com'])
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

describe('toSelection', () => {
  const valid = { courseId: 'algebra-1', unitId: 'linear', subunitId: 'plot', difficulty: 'medium' }
  it('accepts a well-formed selection', () => {
    expect(toSelection(valid)).toEqual({ courseId: 'algebra-1', unitId: 'linear', subunitId: 'plot', difficulty: 'medium' })
  })
  it('rejects a bad difficulty or a missing/nonstring id', () => {
    expect(toSelection({ ...valid, difficulty: 'insane' })).toBeNull()
    expect(toSelection({ ...valid, difficulty: undefined })).toBeNull()
    expect(toSelection({ ...valid, subunitId: 7 })).toBeNull()
    expect(toSelection({ ...valid, courseId: undefined })).toBeNull()
    expect(toSelection(null)).toBeNull()
  })
})

describe('toQueueEntry', () => {
  const flat = { uid: 'u1', email: 'a@b.com', courseId: 'algebra-1', unitId: 'linear', subunitId: 'plot', difficulty: 'easy', createdAt: ts(2) }
  it('requires the doc id to match the uid field and a valid selection', () => {
    expect(toQueueEntry('u1', flat)).toEqual({
      uid: 'u1', email: 'a@b.com',
      sel: { courseId: 'algebra-1', unitId: 'linear', subunitId: 'plot', difficulty: 'easy' },
      createdAtMs: 2,
    })
    expect(toQueueEntry('u1', { ...flat, uid: 'u2' })).toBeNull()
    expect(toQueueEntry('u1', { uid: 'u1', email: 'a@b.com' })).toBeNull() // no selection
    expect(toQueueEntry('u1', { ...flat, difficulty: 'brutal' })).toBeNull()
  })
})

describe('pickOpponent', () => {
  const entry = (uid: string, difficulty: Selection['difficulty'], createdAtMs: number): QueueEntry => ({
    uid, email: `${uid}@x.com`, createdAtMs,
    sel: { courseId: 'algebra-1', unitId: 'u', subunitId: 's', difficulty },
  })
  it('pairs only with a same-difficulty candidate, oldest first', () => {
    const candidates = [entry('a', 'hard', 1), entry('b', 'medium', 2), entry('c', 'medium', 3)]
    expect(pickOpponent('medium', candidates)?.uid).toBe('b') // b is older than c
    expect(pickOpponent('hard', candidates)?.uid).toBe('a')
  })
  it('returns null when no candidate shares the difficulty', () => {
    const candidates = [entry('a', 'hard', 1), entry('b', 'hard', 2)]
    expect(pickOpponent('easy', candidates)).toBeNull()
    expect(pickOpponent('medium', [])).toBeNull()
  })
})

describe('toMatch', () => {
  const sel = { courseId: 'algebra-1', unitId: 'u', subunitId: 's', difficulty: 'easy' }
  const valid = {
    players: ['a', 'b'], emails: { a: 'a@x.com', b: 'b@x.com' },
    status: 'active', turn: 'a', winner: null, endReason: null,
    sel: { a: sel, b: sel }, ready: { a: true, b: true },
    createdAt: ts(10), updatedAt: ts(20),
  }
  it('accepts a well-formed doc and narrows each player selection', () => {
    const m = toMatch('m1', valid)
    expect(m).not.toBeNull()
    expect(m!.players).toEqual(['a', 'b'])
    expect(m!.status).toBe('active')
    expect(m!.winner).toBeNull()
    expect(m!.updatedAtMs).toBe(20)
    expect(m!.sel.a.difficulty).toBe('easy')
    expect(m!.sel.b.subunitId).toBe('s')
  })
  it('treats a missing winner/endReason as null and drops junk email/ready/sel entries', () => {
    const m = toMatch('m1', { ...valid, winner: undefined, endReason: 'bogus', emails: { a: 'a@x.com', b: 9 }, ready: { a: 'yes' }, sel: { a: sel, b: { difficulty: 'nope' } } })
    expect(m!.winner).toBeNull()
    expect(m!.endReason).toBeNull()
    expect(m!.emails).toEqual({ a: 'a@x.com' })
    expect(m!.ready).toEqual({})
    expect(Object.keys(m!.sel)).toEqual(['a']) // b's malformed selection is dropped
  })
  it('rejects malformed docs', () => {
    expect(toMatch('m1', { ...valid, players: ['a'] })).toBeNull()
    expect(toMatch('m1', { ...valid, players: ['a', 'b', 'c'] })).toBeNull()
    expect(toMatch('m1', { ...valid, status: 'paused' })).toBeNull()
    expect(toMatch('m1', { ...valid, turn: 3 })).toBeNull()
  })
  it('tolerates a missing sel map (empty), leaving clients to fall back', () => {
    const m = toMatch('m1', { ...valid, sel: undefined })
    expect(m).not.toBeNull()
    expect(m!.sel).toEqual({})
  })
})

describe('opponentOf', () => {
  const m = toMatch('m1', {
    players: ['a', 'b'], emails: {}, status: 'active', turn: 'a', sel: {}, ready: {},
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
    const sm = toStoredMatch({ fleet })
    expect(sm).not.toBeNull()
    expect(sm!.fleet[0].hits).toBe(0)
  })
  it('rejects malformed fleets', () => {
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
  it('counts distinct cells once — duplicate shots on a cell cannot inflate hits', () => {
    const shots = [
      shot({ id: '1', r: 0, c: 0, result: 'hit' }),
      shot({ id: '2', r: 0, c: 0, result: 'hit' }), // duplicate cell
      shot({ id: '3', r: 0, c: 0, result: 'sunk' }), // even with a lying result
    ]
    const fleet = fleetWithHits(twoShips, shots)
    expect(fleet[0].hits).toBe(1) // NOT 3 — the destroyer is not sunk
    expect(fleet[0].hits).toBeLessThan(fleet[0].size)
  })
  it('never exceeds a ship\'s size even when every cell is duplicated', () => {
    const shots = [
      shot({ id: '1', r: 0, c: 0, result: 'hit' }),
      shot({ id: '2', r: 0, c: 1, result: 'sunk' }),
      shot({ id: '3', r: 0, c: 0, result: 'hit' }),
      shot({ id: '4', r: 0, c: 1, result: 'sunk' }),
    ]
    expect(fleetWithHits(twoShips, shots)[0].hits).toBe(2)
  })
})

describe('priorResultAt', () => {
  const shots = [
    shot({ id: '1', r: 0, c: 0, result: 'hit' }),
    shot({ id: '2', r: 1, c: 1, result: 'pending' }),
  ]
  it('returns the adjudicated result for an already-shot cell', () => {
    expect(priorResultAt(shots, 0, 0)).toBe('hit')
  })
  it('ignores pending shots and unknown cells', () => {
    expect(priorResultAt(shots, 1, 1)).toBeNull()
    expect(priorResultAt(shots, 5, 5)).toBeNull()
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
