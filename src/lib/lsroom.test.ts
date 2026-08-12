import { describe, it, expect } from 'vitest'
import {
  MAX_SEATS, TIMEOUT_GRACE_MS, buildRoomSeats, seatOfUid, isHost, isMyTurn, isMyBanish,
  questionIndexFor, secondsLeftFor, hostShouldResolveTurn, hostShouldBanish, toRoom,
  type LsRoom,
} from './lsroom'
import { applyAnswer, banish, timeForTurn, LIVES } from './laststanding'
import type { Selection } from './social'

const SEL: Selection = { courseId: 'algebra-1', unitId: 'u', subunitId: 's', difficulty: 'medium' }

function room(over: Partial<LsRoom> = {}): LsRoom {
  const { state, seatUids } = buildRoomSeats([
    { uid: 'u1', name: 'ANA' }, { uid: 'u2', name: 'BEN' },
  ])
  return {
    id: 'r1', host: 'u1', members: ['u1', 'u2'], invited: [], names: { u1: 'ANA', u2: 'BEN' },
    status: 'active', sel: SEL, seed: 12345, seatUids, state, tick: 0,
    turnStartedAtMs: 1_000_000, createdAtMs: 1, updatedAtMs: 1, ...over,
  }
}

describe('buildRoomSeats', () => {
  it('always fills the table, humans first then AI', () => {
    const { state, seatUids } = buildRoomSeats([{ uid: 'a', name: 'ANA' }, { uid: 'b', name: 'BEN' }])
    expect(state.seats).toHaveLength(MAX_SEATS)
    expect(state.seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai', 'ai', 'ai'])
    expect(state.seats.map((s) => s.name).slice(0, 2)).toEqual(['ANA', 'BEN'])
    expect(seatUids).toEqual(['a', 'b', null, null, null])
  })

  it('gives every AI seat a distinct name', () => {
    const { state } = buildRoomSeats([{ uid: 'a', name: 'ANA' }])
    const ai = state.seats.filter((s) => s.kind === 'ai').map((s) => s.name)
    expect(new Set(ai).size).toBe(ai.length)
  })

  it('seats a full house of humans with no AI at all', () => {
    const five = Array.from({ length: MAX_SEATS }, (_, i) => ({ uid: `u${i}`, name: `P${i}` }))
    const { state, seatUids } = buildRoomSeats(five)
    expect(state.seats.every((s) => s.kind === 'human')).toBe(true)
    expect(seatUids.every((u) => u !== null)).toBe(true)
  })

  it('never seats more than the table holds', () => {
    const many = Array.from({ length: MAX_SEATS + 3 }, (_, i) => ({ uid: `u${i}`, name: `P${i}` }))
    expect(buildRoomSeats(many).state.seats).toHaveLength(MAX_SEATS)
  })

  it('starts everyone with full lives, round 1, seat 0 to move', () => {
    const { state } = buildRoomSeats([{ uid: 'a', name: 'ANA' }])
    expect(state.seats.every((s) => s.lives === LIVES && s.turnsTaken === 0 && s.inLobby)).toBe(true)
    expect(state.round).toBe(1)
    expect(state.turn).toBe(0)
  })
})

describe('seat routing', () => {
  it('finds a player’s seat and reports non-members as -1', () => {
    const r = room()
    expect(seatOfUid(r, 'u1')).toBe(0)
    expect(seatOfUid(r, 'u2')).toBe(1)
    expect(seatOfUid(r, 'nobody')).toBe(-1)
  })

  it('only the seat on turn is “my turn”', () => {
    const r = room()
    expect(isMyTurn(r, 'u1')).toBe(true)
    expect(isMyTurn(r, 'u2')).toBe(false)
  })

  it('is nobody’s turn while the room is still in the lobby', () => {
    expect(isMyTurn(room({ status: 'lobby' }), 'u1')).toBe(false)
  })

  it('is nobody’s turn during a banish', () => {
    const r = room({ state: { ...room().state, phase: { kind: 'banish', winner: 0 } } })
    expect(isMyTurn(r, 'u1')).toBe(false)
    expect(isMyBanish(r, 'u1')).toBe(true)
    expect(isMyBanish(r, 'u2')).toBe(false)
  })

  it('identifies the host', () => {
    const r = room()
    expect(isHost(r, 'u1')).toBe(true)
    expect(isHost(r, 'u2')).toBe(false)
  })
})

describe('questionIndexFor', () => {
  it('is deterministic — every client picks the same question', () => {
    for (let tick = 0; tick < 50; tick++) {
      expect(questionIndexFor(999, tick, 12)).toBe(questionIndexFor(999, tick, 12))
    }
  })

  it('stays inside the pool', () => {
    for (let tick = 0; tick < 200; tick++) {
      const i = questionIndexFor(4242, tick, 7)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(7)
    }
  })

  it('varies across turns rather than sticking on one question', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, t) => questionIndexFor(5, t, 10)))
    expect(seen.size).toBeGreaterThan(3)
  })

  it('differs between rooms with different seeds', () => {
    const a = Array.from({ length: 20 }, (_, t) => questionIndexFor(1, t, 10)).join()
    const b = Array.from({ length: 20 }, (_, t) => questionIndexFor(2, t, 10)).join()
    expect(a).not.toBe(b)
  })

  it('survives an empty pool instead of dividing by zero', () => {
    expect(questionIndexFor(1, 1, 0)).toBe(0)
  })
})

describe('the clock', () => {
  it('counts down from the seat’s allotted time', () => {
    const r = room({ turnStartedAtMs: 10_000 })
    expect(secondsLeftFor(r, 10_000, 0)).toBe(timeForTurn(0))
    expect(secondsLeftFor(r, 15_000, 0)).toBe(timeForTurn(0) - 5)
  })

  it('floors at zero rather than going negative', () => {
    expect(secondsLeftFor(room({ turnStartedAtMs: 0 }), 999_999, 1)).toBe(0)
  })

  it('falls back to the local clock while the server stamp is in flight', () => {
    const r = room({ turnStartedAtMs: 0 })
    expect(secondsLeftFor(r, 20_000, 20_000)).toBe(timeForTurn(0))
  })
})

describe('host caretaker duties', () => {
  it('resolves an AI seat’s turn immediately', () => {
    const r = room({ state: { ...room().state, turn: 2 } }) // seat 2 is AI
    expect(hostShouldResolveTurn(r, 1_000_000, 1_000_000)).toBe(true)
  })

  it('leaves a human’s turn alone while their clock is still running', () => {
    const r = room({ turnStartedAtMs: 1_000_000 })
    expect(hostShouldResolveTurn(r, 1_000_000 + 5_000, 0)).toBe(false)
  })

  it('does not pounce the instant a human’s clock expires — the grace window holds', () => {
    const r = room({ turnStartedAtMs: 1_000_000 })
    const expiry = 1_000_000 + timeForTurn(0) * 1000
    expect(hostShouldResolveTurn(r, expiry + 1000, 0)).toBe(false)
    expect(hostShouldResolveTurn(r, expiry + TIMEOUT_GRACE_MS + 1, 0)).toBe(true)
  })

  it('stays out of it entirely unless the room is active and on a turn', () => {
    expect(hostShouldResolveTurn(room({ status: 'lobby' }), 9e9, 0)).toBe(false)
    expect(hostShouldResolveTurn(room({ status: 'done' }), 9e9, 0)).toBe(false)
    const banishing = room({ state: { ...room().state, phase: { kind: 'banish', winner: 0 } } })
    expect(hostShouldResolveTurn(banishing, 9e9, 0)).toBe(false)
  })

  it('picks the banish only when an AI won the round, and only for the host', () => {
    const aiWon = room({ state: { ...room().state, phase: { kind: 'banish', winner: 3 } } })
    expect(hostShouldBanish(aiWon, 'u1')).toBe(true)
    expect(hostShouldBanish(aiWon, 'u2')).toBe(false) // not the host
    const humanWon = room({ state: { ...room().state, phase: { kind: 'banish', winner: 1 } } })
    expect(hostShouldBanish(humanWon, 'u1')).toBe(false)
  })
})

describe('toRoom narrowing', () => {
  const good = () => {
    const { state, seatUids } = buildRoomSeats([{ uid: 'u1', name: 'ANA' }])
    return {
      host: 'u1', members: ['u1'], invited: [], names: { u1: 'ANA' }, status: 'lobby',
      sel: SEL, seed: 1, seatUids, state, tick: 0,
    }
  }

  it('accepts a well-formed doc', () => {
    const r = toRoom('r1', good())
    expect(r).not.toBeNull()
    expect(r?.id).toBe('r1')
    expect(r?.state.seats).toHaveLength(MAX_SEATS)
  })

  it('drops unknown fields rather than letting them reach game state', () => {
    const r = toRoom('r1', { ...good(), evil: 'payload' })
    expect(r).not.toBeNull()
    expect((r as unknown as Record<string, unknown>).evil).toBeUndefined()
  })

  it.each([
    ['a bad status', { status: 'hacking' }],
    ['a missing host', { host: 42 }],
    ['no members', { members: [] }],
    ['a malformed selection', { sel: { courseId: 'x' } }],
    ['a negative tick', { tick: -1 }],
    ['a short seat list', { seatUids: ['u1'] }],
    ['a turn pointing off the table', { state: { ...good().state, turn: 99 } }],
    ['an unknown phase', { state: { ...good().state, phase: { kind: 'wat' } } }],
    ['more lives than the game allows', {
      state: { ...good().state, seats: good().state.seats.map((s, i) => i === 0 ? { ...s, lives: 99 } : s) },
    }],
  ])('rejects %s', (_label, patch) => {
    expect(toRoom('r1', { ...good(), ...patch })).toBeNull()
  })

  it('rejects a non-object entirely', () => {
    expect(toRoom('r1', null)).toBeNull()
    expect(toRoom('r1', 'nope')).toBeNull()
  })
})

describe('the room state stays a faithful engine state', () => {
  it('feeds straight back into the pure reducer', () => {
    const r = room()
    const next = applyAnswer(r.state, false)
    expect(next.seats[0].lives).toBe(LIVES - 1)
    expect(next.turn).toBe(1) // play moves on
  })

  it('survives a whole round-trip through the narrower', () => {
    const r = room()
    let s = r.state
    for (let i = 0; i < 6; i++) s = applyAnswer(s, i % 2 === 0)
    const round = toRoom('r1', { ...r, sel: SEL, state: JSON.parse(JSON.stringify(s)) })
    expect(round?.state).toEqual(s)
  })

  it('narrows a banished-seat state without losing the kick', () => {
    let s = room().state
    while (s.phase.kind === 'turn') s = applyAnswer(s, false)
    expect(s.phase.kind).toBe('banish')
    const winner = s.phase.kind === 'banish' ? s.phase.winner : -1
    const target = s.seats.find((x) => x.seat !== winner && x.inLobby)!.seat
    const after = banish(s, target)
    const round = toRoom('r1', { ...room(), sel: SEL, state: JSON.parse(JSON.stringify(after)) })
    expect(round?.state.seats[target].inLobby).toBe(false)
  })
})
