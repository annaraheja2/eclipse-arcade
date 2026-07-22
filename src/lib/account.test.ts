import { describe, it, expect } from 'vitest'
import { buildExportPayload, deleteAccountData } from './account'
import type { PlayerState } from './player'
import type { Friendship } from './social'

const player: PlayerState = {
  coins: 120, xp: 900, streak: 4, lastPlayed: '2026-07-20', bests: { pinpoint: 3200 },
  gamesPlayed: 5, questionsAnswered: 20, questionsCorrect: 16, username: 'AceRunner',
}
const friendships: Friendship[] = [
  { id: 'a_b', uids: ['a', 'b'], emails: ['a@x.com', 'b@x.com'], createdAtMs: 1000 },
]

describe('buildExportPayload', () => {
  it('bundles the player state and friendships with a fixed timestamp', () => {
    const now = new Date('2026-07-21T12:00:00Z')
    const payload = buildExportPayload(player, friendships, now)
    expect(payload.exportedAt).toBe('2026-07-21T12:00:00.000Z')
    expect(payload.player).toEqual(player)
    expect(payload.friendships).toEqual(friendships)
  })

  it('does not alias the inputs by reference identity of the wrapper', () => {
    const payload = buildExportPayload(player, friendships)
    expect(payload).toHaveProperty('exportedAt')
    expect(payload.player).toBe(player)
    expect(payload.friendships).toBe(friendships)
  })
})

// ---------------------------------------------------------------------------
// deleteAccountData against a fake Firestore boundary (injected via deps) —
// locks the "never report false success" invariant: ok is true ONLY when every
// deleteDoc completed. No real SDK is loaded.
// ---------------------------------------------------------------------------

interface FakeRef { path: string }
interface FakeQuery { col: string }
interface FakeDoc { id: string; data: () => unknown }

// A friendships query result the fake returns for the authoritative lookup.
const friendshipDoc: FakeDoc = {
  id: 'me_b',
  data: () => ({ uids: ['me', 'b'], emails: ['me@x.com', 'b@x.com'] }),
}

function makeFakeSdk(opts: { friendshipDocs?: FakeDoc[]; rejectPath?: string }) {
  const deleted: string[] = []
  const sdk = {
    doc: (_db: unknown, col: string, id: string): FakeRef => ({ path: `${col}/${id}` }),
    collection: (_db: unknown, col: string): FakeQuery => ({ col }),
    where: () => ({}),
    query: (c: FakeQuery) => c,
    // Only the friendships collection has docs; friendRequest lookups are empty.
    getDocs: (c: FakeQuery) =>
      Promise.resolve({
        forEach: (fn: (d: FakeDoc) => void) =>
          (c.col === 'friendships' ? opts.friendshipDocs ?? [] : []).forEach(fn),
      }),
    deleteDoc: (ref: FakeRef) => {
      if (ref.path === opts.rejectPath) return Promise.reject(new Error('firestore offline'))
      deleted.push(ref.path)
      return Promise.resolve()
    },
  }
  // The lib types deps as the full firebase/firestore module; the fake supplies
  // only the handful of members deleteAccountData actually calls.
  const deps = { sdk, db: {} } as unknown as NonNullable<Parameters<typeof deleteAccountData>[4]>
  return { deps, deleted }
}

describe('deleteAccountData', () => {
  it('reports ok:true only when every delete completes', async () => {
    const { deps, deleted } = makeFakeSdk({ friendshipDocs: [friendshipDoc] })
    const res = await deleteAccountData('me', 'me@x.com', 'Ace', { includeSocial: true }, deps)
    expect(res).toEqual({ ok: true, failed: [] })
    // The friendship and both derived request docs came from the authoritative
    // query, not any caller-passed array.
    expect(deleted).toContain('friendships/me_b')
    expect(deleted).toContain('friendRequests/me_b@x.com')
    expect(deleted).toContain('friendRequests/b_me@x.com')
    expect(deleted).toContain('players/me')
  })

  it('reports ok:false with the failing step label when a delete rejects', async () => {
    const { deps } = makeFakeSdk({ friendshipDocs: [friendshipDoc], rejectPath: 'players/me' })
    const res = await deleteAccountData('me', 'me@x.com', 'Ace', { includeSocial: true }, deps)
    expect(res.ok).toBe(false)
    expect(res.failed).toContain('player profile')
  })

  it('surfaces a failed friendship delete rather than a false success', async () => {
    const { deps } = makeFakeSdk({ friendshipDocs: [friendshipDoc], rejectPath: 'friendships/me_b' })
    const res = await deleteAccountData('me', 'me@x.com', 'Ace', { includeSocial: true }, deps)
    expect(res.ok).toBe(false)
    expect(res.failed).toContain('friendship me_b')
  })
})
