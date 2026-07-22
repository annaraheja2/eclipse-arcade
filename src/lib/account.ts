// Account data operations for Settings → Data & Privacy: a client-side export
// bundle, and the destructive delete fan-out across every collection a player
// owns. The auth-user deletion itself lives in lib/auth.tsx (deleteAccount);
// this module owns only the Firestore side.
//
// Pattern mirrors the rest of lib/: a pure, unit-tested assembler
// (buildExportPayload) plus the Firestore boundary using the lazy-SDK loader.
import { getFirebaseDb } from './firebase'
import { friendRequestIdsFor, toFriendship, type Friendship } from './social'
import { normalizeUsername } from './username'
import type { PlayerState } from './player'

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

// The Firestore boundary this module writes through. Injectable so the delete
// fan-out can be unit-tested against a fake sdk/db without the real SDK.
type Fs = Awaited<ReturnType<typeof fs>>

// ---------------------------------------------------------------------------
// Export (pure assembly + client download)
// ---------------------------------------------------------------------------

export interface ExportPayload {
  exportedAt: string // ISO 8601
  player: PlayerState
  friendships: Friendship[]
}

/** Assembles the downloadable bundle. Pure — the download side effect is the caller's. */
export function buildExportPayload(
  player: PlayerState, friendships: Friendship[], now: Date = new Date()
): ExportPayload {
  return { exportedAt: now.toISOString(), player, friendships }
}

// ---------------------------------------------------------------------------
// Delete fan-out
// ---------------------------------------------------------------------------

export interface DeletionResult {
  ok: boolean
  failed: string[] // human-readable labels of the steps that did NOT complete
}

/**
 * Deletes every Firestore doc the player owns, in a retry-safe order:
 * friendships (+ both directional friend-request docs), any leftover friend
 * requests they sent or received, their matchQueue entry, their username
 * reservation, and finally their players doc.
 *
 * Idempotent: deleting an already-gone doc is a no-op, so a partial run can be
 * retried. Every failure is collected and surfaced — the result is `ok` ONLY
 * when nothing failed, so the caller never proceeds to delete the auth user on
 * a partial cleanup.
 *
 * `includeSocial` is the caller's emailVerified state: an unverified account
 * can never have created any social docs (firestore.rules gate them behind a
 * verified email) AND cannot even read friendRequests, so we skip that whole
 * branch rather than let a guaranteed permission-denied block deletion.
 *
 * `deps` is the Firestore boundary; it defaults to the real lazy-loaded SDK and
 * is injected only by unit tests.
 */
export async function deleteAccountData(
  uid: string,
  email: string,
  username: string | undefined,
  { includeSocial }: { includeSocial: boolean },
  deps?: Fs
): Promise<DeletionResult> {
  const { sdk, db } = deps ?? await fs()
  const failed: string[] = []

  const del = async (label: string, path: [string, string]) => {
    try {
      await sdk.deleteDoc(sdk.doc(db, path[0], path[1]))
    } catch (err) {
      console.error(`[eclipse-arcade] delete ${label} failed:`, err)
      failed.push(label)
    }
  }

  if (includeSocial) {
    // Fetch the AUTHORITATIVE friendships at delete time rather than trusting a
    // subscription snapshot the caller passed in: if that subscription had
    // errored it would be empty, silently orphaning the other party's
    // friendship doc (which still points at this now-deleted uid). Each
    // friendship is deleted along with the deterministic accepted request docs
    // on both sides (so the ids can't block a future re-friend — mirrors
    // removeFriend).
    try {
      const snap = await sdk.getDocs(
        sdk.query(sdk.collection(db, 'friendships'), sdk.where('uids', 'array-contains', uid))
      )
      const friendships: Friendship[] = []
      snap.forEach((d) => {
        const f = toFriendship(d.id, d.data())
        if (f) friendships.push(f)
      })
      for (const f of friendships) {
        await del(`friendship ${f.id}`, ['friendships', f.id])
        const [idA, idB] = friendRequestIdsFor(f)
        await del(`friend request ${idA}`, ['friendRequests', idA])
        await del(`friend request ${idB}`, ['friendRequests', idB])
      }
    } catch (err) {
      console.error('[eclipse-arcade] friendships lookup failed:', err)
      failed.push('friendships')
    }
    // Any remaining pending/settled requests I sent or received.
    try {
      const [sent, received] = await Promise.all([
        sdk.getDocs(sdk.query(sdk.collection(db, 'friendRequests'), sdk.where('fromUid', '==', uid))),
        sdk.getDocs(sdk.query(sdk.collection(db, 'friendRequests'), sdk.where('toEmail', '==', email))),
      ])
      const ids = new Set<string>()
      sent.forEach((d) => ids.add(d.id))
      received.forEach((d) => ids.add(d.id))
      for (const id of ids) await del(`friend request ${id}`, ['friendRequests', id])
    } catch (err) {
      console.error('[eclipse-arcade] friend-request lookup failed:', err)
      failed.push('friend requests')
    }
  }

  await del('matchmaking queue entry', ['matchQueue', uid])
  if (username) await del('username reservation', ['usernames', normalizeUsername(username)])
  await del('player profile', ['players', uid])

  return { ok: failed.length === 0, failed }
}
