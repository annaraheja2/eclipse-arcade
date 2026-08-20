// The regression this file exists for: an invite whose game had no case here.
// Accepting a Card Game invite used to throw ("not available yet") and a Racer
// invite fell through the switch entirely — navigating to the table without ever
// taking a seat. Both looked identical to the player: "Could not join".
//
// So the contract under test is coverage, not any one game: EVERY kind an invite
// can carry must reach a real join and a real decline.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GameInvite, InviteKind } from './invites'

const acceptInvite = vi.fn(async () => {})
const deleteInviteMatch = vi.fn(async () => {})
const joinRoom = vi.fn(async () => {})
const leaveRoom = vi.fn(async () => {})
const joinGameRoom = vi.fn(async () => {})
const leaveGameRoom = vi.fn(async () => {})

vi.mock('./social', () => ({ acceptInvite, deleteInviteMatch }))
vi.mock('./lsroom', () => ({ joinRoom, leaveRoom }))
vi.mock('./gameroom', () => ({ joinGameRoom, leaveGameRoom, ROOM_MAX_SEATS: 6 }))

const { acceptGameInvite, declineGameInvite } = await import('./inviteActions')
const { TABLE_RULES } = await import('./gameTables')

const ME = { uid: 'me', name: 'ME' }

const invite = (kind: InviteKind): GameInvite => ({
  id: `id-${kind}`,
  kind,
  gameName: kind,
  fromUid: 'friend',
  invitedAtMs: 0,
  route: `/${kind}/room/id-${kind}`,
})

/** Every value an invite's `kind` can hold. Adding a game here is the point. */
const ALL_KINDS: InviteKind[] = ['battleship', 'laststanding', 'ascend', 'cardgame', 'racer']
const TABLE_KINDS = ['ascend', 'cardgame', 'racer'] as const

beforeEach(() => {
  for (const fn of [acceptInvite, deleteInviteMatch, joinRoom, leaveRoom, joinGameRoom, leaveGameRoom]) {
    fn.mockClear()
  }
})

describe('acceptGameInvite', () => {
  it.each(ALL_KINDS)('seats the player for a %s invite and returns its route', async (kind) => {
    const i = invite(kind)
    await expect(acceptGameInvite(i, ME)).resolves.toBe(i.route)
    const calls = acceptInvite.mock.calls.length + joinRoom.mock.calls.length
      + joinGameRoom.mock.calls.length
    expect(calls).toBe(1)
  })

  it.each(TABLE_KINDS)('joins a %s table with that game\'s seat count', async (kind) => {
    await acceptGameInvite(invite(kind), ME)
    const [roomId, me, maxSeats] = joinGameRoom.mock.calls[0] as unknown as [string, unknown, number]
    expect(roomId).toBe(`id-${kind}`)
    expect(me).toEqual(ME)
    expect(maxSeats).toBe(TABLE_RULES[kind].maxSeats)
  })
})

describe('declineGameInvite', () => {
  it.each(ALL_KINDS)('removes a %s invite', async (kind) => {
    await declineGameInvite(invite(kind), ME.uid)
    const calls = deleteInviteMatch.mock.calls.length + leaveRoom.mock.calls.length
      + leaveGameRoom.mock.calls.length
    expect(calls).toBe(1)
  })

  it.each(TABLE_KINDS)('leaves a %s table with that game\'s seat count', async (kind) => {
    await declineGameInvite(invite(kind), ME.uid)
    const [, uid, maxSeats] = leaveGameRoom.mock.calls[0] as unknown as [string, string, number]
    expect(uid).toBe(ME.uid)
    expect(maxSeats).toBe(TABLE_RULES[kind].maxSeats)
  })
})
