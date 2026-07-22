// Usernames — unique, server-reserved handles.
//
// Data model: `usernames/{usernameLower}` is the uniqueness key (the doc id IS
// the lowercased handle), storing { uid, username (display case), createdAt }.
// The player's chosen handle also mirrors onto players/{uid}.username so it
// syncs with the rest of player state.
//
// Layout mirrors lib/social.ts: pure, unit-tested helpers first (validation +
// display name), then the Firestore boundary (availability, the claim
// transaction, and batch reverse-lookup for display) using the lazy-SDK pattern
// from lib/firebase.ts.
import { getFirebaseDb } from './firebase'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Canonical (case-insensitive) form of a handle — the usernames doc id. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export type UsernameValidation =
  | { ok: true; value: string; lower: string }
  | { ok: false; reason: string }

const MIN_LEN = 3
const MAX_LEN = 20

/**
 * Validates a raw handle against the chosen rules and returns the trimmed
 * display-case `value` plus its lowercased `lower` (the reservation key), or a
 * single friendly `reason`. Rules (checked in this order, so the reason is
 * deterministic):
 *   1. 3–20 characters
 *   2. must start with a letter (also rules out a leading digit/underscore)
 *   3. letters, digits, and underscores only
 *   4. no two underscores in a row
 *   5. must not end with an underscore
 */
export function validateUsername(raw: string): UsernameValidation {
  const value = raw.trim()
  if (value.length < MIN_LEN || value.length > MAX_LEN) {
    return { ok: false, reason: `Username must be ${MIN_LEN}–${MAX_LEN} characters.` }
  }
  if (!/^[A-Za-z]/.test(value)) {
    return { ok: false, reason: 'Username must start with a letter.' }
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    return { ok: false, reason: 'Use only letters, numbers, and underscores.' }
  }
  if (/__/.test(value)) {
    return { ok: false, reason: 'No two underscores in a row.' }
  }
  if (/_$/.test(value)) {
    return { ok: false, reason: "Username can't end with an underscore." }
  }
  return { ok: true, value, lower: value.toLowerCase() }
}

/** The name to show for a person: their handle if set, else email, else a generic label. */
export function displayNameFor(username: string | null | undefined, email: string | null | undefined): string {
  const u = username?.trim()
  if (u) return u
  const e = email?.trim()
  if (e) return e
  return 'a player'
}

/** The write decisions for a claim, once the relevant docs have been read. */
export type ClaimPlan =
  | { kind: 'taken' }
  | { kind: 'ok'; writeReservation: boolean; releasePrev: string | null }

/**
 * Pure decision core of {@link claimUsername}: given the in-transaction reads,
 * decide what to write. Kept separate from the Firestore boundary so the tricky
 * cases are unit-testable without mocking a transaction. The two subtleties:
 *
 *   - Re-saving the CURRENT handle: the target reservation already exists and is
 *     ours. The usernames collection has NO update rule, so re-writing that doc
 *     would be denied and abort the whole transaction — so `writeReservation` is
 *     false and only the player mirror is refreshed.
 *   - Renaming with a diverged mirror: only release the prior reservation when it
 *     still exists AND is ours; an unconditional delete of a missing/foreign doc
 *     is denied and would likewise abort. Callers pass `prevOwnerUid: null` when
 *     the prior doc is absent.
 */
export function planUsernameClaim(args: {
  uid: string
  lower: string
  targetOwnerUid: string | null
  prevLower: string | null
  prevOwnerUid: string | null
}): ClaimPlan {
  const { uid, lower, targetOwnerUid, prevLower, prevOwnerUid } = args
  if (targetOwnerUid !== null && targetOwnerUid !== uid) return { kind: 'taken' }
  const alreadyOurs = targetOwnerUid === uid
  const renaming = prevLower !== null && prevLower !== lower
  const releasePrev = renaming && prevOwnerUid === uid ? prevLower : null
  return { kind: 'ok', writeReservation: !alreadyOurs, releasePrev }
}

// ---------------------------------------------------------------------------
// Firestore boundary. Errors propagate to callers (claimUsername maps them to a
// typed Result); the lazy SDK is only fetched when configured.
// ---------------------------------------------------------------------------

const USERNAMES = 'usernames'
const PLAYERS = 'players'

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

/** Reads a string field off an untrusted doc snapshot payload, or null. */
function readString(data: unknown, key: string): string | null {
  if (typeof data === 'object' && data !== null) {
    const v = (data as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return null
}

/** True if no reservation exists for this lowercased handle yet. */
export async function isUsernameAvailable(lower: string): Promise<boolean> {
  const { sdk, db } = await fs()
  const snap = await sdk.getDoc(sdk.doc(db, USERNAMES, lower))
  return !snap.exists()
}

export type ClaimResult = { ok: true; username: string } | { ok: false; message: string }

// Transaction sentinel: the handle is already reserved by someone else.
class UsernameTaken extends Error {}

/**
 * Claims (or renames to) a handle for this user, atomically.
 *
 * A Firestore TRANSACTION reads usernames/{lower} — putting it in the read set,
 * so two simultaneous claims of the same handle can't both commit: Firestore
 * retries the loser, which re-reads the now-taken doc and fails cleanly with
 * "taken". The write decisions live in the pure {@link planUsernameClaim}; this
 * boundary just reads the docs, applies the plan (release a stale-but-owned prior
 * reservation, reserve the new handle unless it's already ours), and always
 * mirrors the handle onto the player doc. Validation happens first; every failure
 * is a typed Result.
 */
export async function claimUsername(uid: string, email: string | null, raw: string): Promise<ClaimResult> {
  const check = validateUsername(raw)
  if (!check.ok) return { ok: false, message: check.reason }
  const { value, lower } = check
  const { sdk, db } = await fs()
  try {
    await sdk.runTransaction(db, async (tx) => {
      const usernameRef = sdk.doc(db, USERNAMES, lower)
      const playerRef = sdk.doc(db, PLAYERS, uid)
      // Firestore requires all reads before any writes in a transaction.
      const [usernameSnap, playerSnap] = await Promise.all([tx.get(usernameRef), tx.get(playerRef)])
      const targetOwnerUid = usernameSnap.exists() ? readString(usernameSnap.data(), 'uid') : null
      const prev = playerSnap.exists() ? readString(playerSnap.data(), 'username') : null
      const prevLower = prev !== null ? prev.toLowerCase() : null

      // Reading the prior reservation (only when actually renaming) tells the
      // planner whether releasing it is safe — a diverged mirror pointing at a
      // missing/foreign doc must not become a denied delete that aborts the tx.
      let prevOwnerUid: string | null = null
      if (prevLower !== null && prevLower !== lower) {
        const prevSnap = await tx.get(sdk.doc(db, USERNAMES, prevLower))
        prevOwnerUid = prevSnap.exists() ? readString(prevSnap.data(), 'uid') : null
      }

      const plan = planUsernameClaim({ uid, lower, targetOwnerUid, prevLower, prevOwnerUid })
      if (plan.kind === 'taken') throw new UsernameTaken()

      if (plan.releasePrev !== null) tx.delete(sdk.doc(db, USERNAMES, plan.releasePrev))
      if (plan.writeReservation) {
        tx.set(usernameRef, { uid, username: value, createdAt: sdk.serverTimestamp() })
      }
      // Mirror onto the player doc so the handle syncs like the rest of player
      // state; email keeps the write satisfying the players rule.
      tx.set(playerRef, { username: value, email, updatedAt: sdk.serverTimestamp() }, { merge: true })
    })
    return { ok: true, username: value }
  } catch (err) {
    if (err instanceof UsernameTaken) return { ok: false, message: 'That username is taken — try another.' }
    console.error('[eclipse-arcade] username claim failed:', err)
    return { ok: false, message: 'Could not save your username — check your connection and try again.' }
  }
}

/**
 * Reverse-lookup: uid -> display handle, for showing names instead of emails.
 * Reads the public usernames collection; uids with no reservation are simply
 * absent from the map (callers fall back to email).
 */
export async function resolveUsernames(uids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(uids)].filter((u) => u.length > 0)
  if (unique.length === 0) return {}
  const { sdk, db } = await fs()
  const out: Record<string, string> = {}
  // Firestore 'in' accepts up to 30 values; chunk defensively.
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    const snap = await sdk.getDocs(sdk.query(sdk.collection(db, USERNAMES), sdk.where('uid', 'in', chunk)))
    snap.forEach((d) => {
      const uid = readString(d.data(), 'uid')
      const username = readString(d.data(), 'username')
      if (uid !== null && username !== null) out[uid] = username
    })
  }
  return out
}
