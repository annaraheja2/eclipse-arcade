// Online play over Firestore — friends, quick-match queue, and live PvP
// Battleship.
//
// TRUST MODEL (deliberate, for this friendly prototype): there is no game
// server. Each player's fleet NEVER leaves their device — it lives only in
// component state and per-match localStorage, so the opponent physically
// cannot read it. The shooter writes a shot doc with result 'pending'; the
// DEFENDER's client adjudicates it against its local fleet (the same pure
// applyFire used vs the AI) and writes back the result, the turn flip, and —
// when its own last ship goes down — the game end. A hacked client could lie
// about results; that is accepted here. The honest path is airtight.
//
// Layout mirrors lib/content.ts: pure helpers first (narrowing untrusted docs,
// id derivation, adjudication — unit-tested), the Firestore boundary at the
// bottom using the lazy-SDK pattern from lib/firebase.ts.
import { applyFire, allSunk, N, type Ship, type Cell } from './battleship'
import { getFirebaseDb } from './firebase'

// ---------------------------------------------------------------------------
// Types — discriminated by their `status`/`result` unions
// ---------------------------------------------------------------------------

export type RequestStatus = 'pending' | 'accepted' | 'declined'
export interface FriendRequest {
  id: string
  fromUid: string
  fromEmail: string
  toEmail: string
  status: RequestStatus
  createdAtMs: number
}

export interface Friendship {
  id: string
  uids: [string, string]
  emails: [string, string] // aligned with uids
  createdAtMs: number
}

export interface QueueEntry { uid: string; email: string; createdAtMs: number }

export type MatchStatus = 'invite' | 'placing' | 'active' | 'done'
export type EndReason = 'fleet-sunk' | 'forfeit' | 'timeout'
export interface Match {
  id: string
  players: [string, string] // players[0] created the match (for invites: the inviter)
  emails: Record<string, string> // uid -> email
  status: MatchStatus
  turn: string // uid whose move it is
  winner: string | null
  endReason: EndReason | null
  courseId: string
  ready: Record<string, boolean> // uid -> fleet locked in
  createdAtMs: number
  updatedAtMs: number
}

export type ShotResult = 'pending' | 'miss' | 'hit' | 'sunk'
export interface Shot {
  id: string
  by: string // shooter uid
  r: number
  c: number
  seq: number // shooter-assigned ordinal, for stable ordering
  result: ShotResult
  createdAtMs: number
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Canonical friendship doc id: the two uids sorted and joined with '_'. */
export function friendshipId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_')
}

/** The other participant's uid, or null if `uid` isn't in the match. */
export function opponentOf(match: Match, uid: string): string | null {
  if (match.players[0] === uid) return match.players[1]
  if (match.players[1] === uid) return match.players[0]
  return null
}

/** Lowercased/trimmed email, or null if it isn't a plausible address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): v is string => typeof v === 'string'
// Firestore Timestamps arrive as objects with toMillis(); a serverTimestamp
// still pending locally arrives as null. Anything else is malformed → 0.
function millisOf(v: unknown): number {
  if (isRecord(v) && typeof v.toMillis === 'function') {
    const n = (v.toMillis as () => unknown)()
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return 0
}
const gridInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < N

const REQUEST_STATUSES: readonly RequestStatus[] = ['pending', 'accepted', 'declined']
const MATCH_STATUSES: readonly MatchStatus[] = ['invite', 'placing', 'active', 'done']
const END_REASONS: readonly EndReason[] = ['fleet-sunk', 'forfeit', 'timeout']
const SHOT_RESULTS: readonly ShotResult[] = ['pending', 'miss', 'hit', 'sunk']

/** Narrows an untrusted friendRequests doc, or null if malformed. */
export function toFriendRequest(id: string, data: unknown): FriendRequest | null {
  if (!isRecord(data)) return null
  const { fromUid, fromEmail, toEmail, status } = data
  if (!str(fromUid) || !str(fromEmail) || !str(toEmail)) return null
  if (!str(status) || !(REQUEST_STATUSES as readonly string[]).includes(status)) return null
  return { id, fromUid, fromEmail, toEmail, status: status as RequestStatus, createdAtMs: millisOf(data.createdAt) }
}

/** Narrows an untrusted friendships doc, or null if malformed. */
export function toFriendship(id: string, data: unknown): Friendship | null {
  if (!isRecord(data)) return null
  const { uids, emails } = data
  if (!Array.isArray(uids) || uids.length !== 2 || !uids.every(str)) return null
  if (!Array.isArray(emails) || emails.length !== 2 || !emails.every(str)) return null
  return { id, uids: [uids[0], uids[1]], emails: [emails[0], emails[1]], createdAtMs: millisOf(data.createdAt) }
}

/** Narrows an untrusted matchQueue doc, or null if malformed. */
export function toQueueEntry(id: string, data: unknown): QueueEntry | null {
  if (!isRecord(data) || !str(data.uid) || data.uid !== id || !str(data.email)) return null
  return { uid: data.uid, email: data.email, createdAtMs: millisOf(data.createdAt) }
}

/** Narrows an untrusted matches doc, or null if malformed. */
export function toMatch(id: string, data: unknown): Match | null {
  if (!isRecord(data)) return null
  const { players, status, turn, courseId } = data
  if (!Array.isArray(players) || players.length !== 2 || !players.every(str)) return null
  if (!str(status) || !(MATCH_STATUSES as readonly string[]).includes(status)) return null
  if (!str(turn) || !str(courseId)) return null
  const emails: Record<string, string> = {}
  if (isRecord(data.emails)) {
    for (const [k, v] of Object.entries(data.emails)) if (str(v)) emails[k] = v
  }
  const ready: Record<string, boolean> = {}
  if (isRecord(data.ready)) {
    for (const [k, v] of Object.entries(data.ready)) if (typeof v === 'boolean') ready[k] = v
  }
  const winner = str(data.winner) ? data.winner : null
  const endReason =
    str(data.endReason) && (END_REASONS as readonly string[]).includes(data.endReason)
      ? (data.endReason as EndReason)
      : null
  return {
    id, players: [players[0], players[1]], emails, status: status as MatchStatus,
    turn, winner, endReason, courseId, ready,
    createdAtMs: millisOf(data.createdAt), updatedAtMs: millisOf(data.updatedAt),
  }
}

/** Narrows an untrusted shots doc, or null if malformed. */
export function toShot(id: string, data: unknown): Shot | null {
  if (!isRecord(data)) return null
  const { by, r, c, seq, result } = data
  if (!str(by) || !gridInt(r) || !gridInt(c)) return null
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return null
  if (!str(result) || !(SHOT_RESULTS as readonly string[]).includes(result)) return null
  return { id, by, r, c, seq, result: result as ShotResult, createdAtMs: millisOf(data.createdAt) }
}

/** Stable shot order: by shooter-assigned seq, then server time, then id. */
export function sortShots(shots: Shot[]): Shot[] {
  return [...shots].sort(
    (a, b) => a.seq - b.seq || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)
  )
}

/**
 * Defender-side adjudication of one incoming shot against the local fleet —
 * the write it produces is what the shooter (and both grids) trust.
 */
export function adjudicateShot(
  fleet: Ship[], r: number, c: number
): { fleet: Ship[]; result: 'miss' | 'hit' | 'sunk'; fleetSunk: boolean } {
  const { ships, result } = applyFire(fleet, r, c)
  return { fleet: ships, result, fleetSunk: allSunk(ships) }
}

/**
 * Rebuilds a fleet's hit state from the opponent's adjudicated shots — the
 * same deterministic mapping the defender ran, so a refreshed client (fleet
 * cells from localStorage, shots from Firestore) reconverges exactly.
 */
export function fleetWithHits(fleet: Ship[], oppShots: Shot[]): Ship[] {
  return fleet.map((sh) => ({
    ...sh,
    hits: oppShots.filter(
      (s) => s.result !== 'pending' && sh.cells.some((x) => x.r === s.r && x.c === s.c)
    ).length,
  }))
}

/** Shot list → BattleGrid marks. Pending shots don't render until adjudicated. */
export function shotMarks(shots: Shot[]): Record<string, 'hit' | 'miss'> {
  const marks: Record<string, 'hit' | 'miss'> = {}
  for (const s of shots) {
    if (s.result === 'pending') continue
    marks[`${s.r},${s.c}`] = s.result === 'miss' ? 'miss' : 'hit'
  }
  return marks
}

// ---------------------------------------------------------------------------
// Per-match localStorage — the fleet must survive a refresh WITHOUT ever
// touching Firestore (see trust model above). Hits are not stored; they are
// re-derived from the shot log via fleetWithHits.
// ---------------------------------------------------------------------------

export interface StoredMatch {
  fleet: Ship[]
  subunitId: string | null
}

const matchKey = (matchId: string) => `eclipse-arcade:match:${matchId}`

/** Narrows an untrusted localStorage blob, or null if malformed. */
export function toStoredMatch(data: unknown): StoredMatch | null {
  if (!isRecord(data) || !Array.isArray(data.fleet)) return null
  const fleet: Ship[] = []
  for (const raw of data.fleet) {
    if (!isRecord(raw) || !str(raw.id)) return null
    if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size < 1) return null
    if (!Array.isArray(raw.cells) || raw.cells.length !== raw.size) return null
    const cells: Cell[] = []
    for (const cell of raw.cells) {
      if (!isRecord(cell) || !gridInt(cell.r) || !gridInt(cell.c)) return null
      cells.push({ r: cell.r, c: cell.c })
    }
    fleet.push({ id: raw.id, size: raw.size, cells, hits: 0 })
  }
  if (fleet.length === 0) return null
  return { fleet, subunitId: str(data.subunitId) ? data.subunitId : null }
}

export function loadStoredMatch(matchId: string): StoredMatch | null {
  try {
    const raw = localStorage.getItem(matchKey(matchId))
    return raw ? toStoredMatch(JSON.parse(raw)) : null
  } catch { return null }
}

export function saveStoredMatch(matchId: string, stored: StoredMatch): void {
  localStorage.setItem(
    matchKey(matchId),
    JSON.stringify({ ...stored, fleet: stored.fleet.map((s) => ({ id: s.id, size: s.size, cells: s.cells })) })
  )
}

// Rewards must be granted exactly once per match, even across refreshes and
// even when the match ended before a fleet was ever saved — so the flag gets
// its own key rather than living inside StoredMatch.
export function wasRewarded(matchId: string): boolean {
  try { return localStorage.getItem(`${matchKey(matchId)}:rewarded`) === '1' } catch { return true }
}
export function markRewarded(matchId: string): void {
  localStorage.setItem(`${matchKey(matchId)}:rewarded`, '1')
}

// ---------------------------------------------------------------------------
// Firestore boundary. Errors propagate to callers — pages surface them inline.
// Subscriptions return a synchronous cleanup that also cancels the pending
// lazy-SDK load, so effect teardown is always one call.
// ---------------------------------------------------------------------------

const REQUESTS = 'friendRequests'
const FRIENDSHIPS = 'friendships'
const QUEUE = 'matchQueue'
const MATCHES = 'matches'
const SHOTS = 'shots'

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

type Sdk = Awaited<ReturnType<typeof fs>>['sdk']
type Db = Awaited<ReturnType<typeof fs>>['db']
type Query = ReturnType<Sdk['query']>

function subscribe<T>(
  buildQuery: (sdk: Sdk, db: Db) => Query,
  narrow: (id: string, data: unknown) => T | null,
  onChange: (items: T[]) => void,
  onError: (err: unknown) => void
): () => void {
  let unsub: (() => void) | undefined
  let cancelled = false
  fs()
    .then(({ sdk, db }) => {
      if (cancelled) return
      unsub = sdk.onSnapshot(
        buildQuery(sdk, db),
        (snap) => {
          const items: T[] = []
          snap.forEach((d) => {
            const item = narrow(d.id, d.data())
            if (item) items.push(item)
          })
          onChange(items)
        },
        onError
      )
    })
    .catch(onError)
  return () => { cancelled = true; unsub?.() }
}

// ----- friends -----

/** Sends a friend request by email. The address is stored lowercased. */
export async function sendFriendRequest(fromUid: string, fromEmail: string, toEmail: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.addDoc(sdk.collection(db, REQUESTS), {
    fromUid, fromEmail: fromEmail.toLowerCase(), toEmail, status: 'pending', createdAt: sdk.serverTimestamp(),
  })
}

/** True if a pending request from this sender to this address already exists. */
export async function hasPendingRequest(fromUid: string, toEmail: string): Promise<boolean> {
  const { sdk, db } = await fs()
  const snap = await sdk.getDocs(sdk.query(
    sdk.collection(db, REQUESTS),
    sdk.where('fromUid', '==', fromUid),
    sdk.where('toEmail', '==', toEmail),
    sdk.where('status', '==', 'pending'),
  ))
  return !snap.empty
}

/** Live list of pending requests addressed to this email, oldest first. */
export function subscribeIncomingRequests(
  email: string, onChange: (reqs: FriendRequest[]) => void, onError: (err: unknown) => void
): () => void {
  return subscribe(
    (sdk, db) => sdk.query(
      sdk.collection(db, REQUESTS),
      sdk.where('toEmail', '==', email),
      sdk.where('status', '==', 'pending'),
    ),
    toFriendRequest,
    (reqs) => onChange(reqs.sort((a, b) => a.createdAtMs - b.createdAtMs)),
    onError
  )
}

/**
 * Settles a pending request. Accepting also creates the friendships doc (the
 * accepter is the only party who knows both uids at this point) in one batch.
 */
export async function respondToRequest(req: FriendRequest, accept: boolean, myUid: string): Promise<void> {
  const { sdk, db } = await fs()
  const batch = sdk.writeBatch(db)
  batch.update(sdk.doc(db, REQUESTS, req.id), { status: accept ? 'accepted' : 'declined' })
  if (accept) {
    const uids = [req.fromUid, myUid].sort() as [string, string]
    const emailOf: Record<string, string> = { [req.fromUid]: req.fromEmail, [myUid]: req.toEmail }
    batch.set(sdk.doc(db, FRIENDSHIPS, friendshipId(req.fromUid, myUid)), {
      uids, emails: [emailOf[uids[0]], emailOf[uids[1]]], createdAt: sdk.serverTimestamp(),
    })
  }
  await batch.commit()
}

/** Live list of this player's friendships. */
export function subscribeFriendships(
  uid: string, onChange: (friends: Friendship[]) => void, onError: (err: unknown) => void
): () => void {
  return subscribe(
    (sdk, db) => sdk.query(sdk.collection(db, FRIENDSHIPS), sdk.where('uids', 'array-contains', uid)),
    toFriendship,
    (fr) => onChange(fr.sort((a, b) => a.createdAtMs - b.createdAtMs)),
    onError
  )
}

// ----- quick-match queue -----

export async function joinQueue(uid: string, email: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.setDoc(sdk.doc(db, QUEUE, uid), { uid, email, createdAt: sdk.serverTimestamp() })
}

/** Best-effort on cleanup paths — deleting an already-removed doc is a no-op. */
export async function leaveQueue(uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.deleteDoc(sdk.doc(db, QUEUE, uid))
}

// Transaction abort marker: the candidate's queue doc vanished mid-pairing
// (they cancelled, or another joiner claimed them first).
class PairAbort extends Error {}

/**
 * Tries to pair with the oldest waiting stranger. For each candidate, a
 * transaction re-reads their queue doc, creates the match, and deletes BOTH
 * queue docs atomically — so two joiners can never both claim the same player.
 *
 * RACE HANDLING: if the candidate's doc vanished before our transaction
 * committed (Firestore retries the closure; the re-read sees it gone), we
 * abort that candidate and move to the next. If every candidate is gone we
 * return null and stay queued — our own queue doc is already up, so the next
 * joiner pairs with us and our match subscription picks the new match up.
 *
 * The queued (waiting) player gets the first turn.
 */
export async function attemptPair(uid: string, email: string, courseId: string): Promise<string | null> {
  const { sdk, db } = await fs()
  const snap = await sdk.getDocs(sdk.query(sdk.collection(db, QUEUE), sdk.orderBy('createdAt'), sdk.limit(8)))
  const candidates: QueueEntry[] = []
  snap.forEach((d) => {
    const entry = toQueueEntry(d.id, d.data())
    if (entry && entry.uid !== uid) candidates.push(entry)
  })
  for (const cand of candidates) {
    try {
      return await sdk.runTransaction(db, async (tx) => {
        const candRef = sdk.doc(db, QUEUE, cand.uid)
        const fresh = await tx.get(candRef)
        if (!fresh.exists()) throw new PairAbort()
        const matchRef = sdk.doc(sdk.collection(db, MATCHES))
        tx.set(matchRef, {
          players: [uid, cand.uid],
          emails: { [uid]: email, [cand.uid]: cand.email },
          status: 'placing', turn: cand.uid, winner: null, endReason: null,
          courseId, ready: {},
          createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
        })
        tx.delete(candRef)
        tx.delete(sdk.doc(db, QUEUE, uid))
        return matchRef.id
      })
    } catch (err) {
      if (err instanceof PairAbort) continue
      throw err
    }
  }
  return null
}

// ----- matches -----

/** Creates a friend-invite match. The inviter (players[0]) moves first. */
export async function createInviteMatch(
  me: { uid: string; email: string }, friend: { uid: string; email: string }, courseId: string
): Promise<string> {
  const { sdk, db } = await fs()
  const ref = await sdk.addDoc(sdk.collection(db, MATCHES), {
    players: [me.uid, friend.uid],
    emails: { [me.uid]: me.email, [friend.uid]: friend.email },
    status: 'invite', turn: me.uid, winner: null, endReason: null,
    courseId, ready: {},
    createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
  })
  return ref.id
}

/** Invitee accepts: the match moves to fleet placement. */
export async function acceptInvite(matchId: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.updateDoc(sdk.doc(db, MATCHES, matchId), { status: 'placing', updatedAt: sdk.serverTimestamp() })
}

/** Removes an unaccepted invite (declined by invitee, or cancelled by inviter). */
export async function deleteInviteMatch(matchId: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.deleteDoc(sdk.doc(db, MATCHES, matchId))
}

/**
 * Locks this player's fleet in. Runs as a transaction so the second READY
 * reliably sees the first and flips the match to 'active'.
 */
export async function setReady(matchId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, MATCHES, matchId)
    const snap = await tx.get(ref)
    const match = toMatch(matchId, snap.data())
    if (!match || match.status !== 'placing') throw new Error('Match is no longer in placement.')
    const ready = { ...match.ready, [uid]: true }
    const bothReady = match.players.every((p) => ready[p] === true)
    tx.update(ref, { ready, status: bothReady ? 'active' : 'placing', updatedAt: sdk.serverTimestamp() })
  })
}

/** Wrong answer: the turn passes to the opponent without a shot. */
export async function passTurn(matchId: string, toUid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.updateDoc(sdk.doc(db, MATCHES, matchId), { turn: toUid, updatedAt: sdk.serverTimestamp() })
}

/** Shooter files a shot; the defender's client will adjudicate it. */
export async function fireShot(matchId: string, uid: string, r: number, c: number, seq: number): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.addDoc(sdk.collection(db, MATCHES, matchId, SHOTS), {
    by: uid, r, c, seq, result: 'pending', createdAt: sdk.serverTimestamp(),
  })
}

/**
 * Defender writes the adjudicated result and flips the turn to themselves in
 * one batch; when the shot sank their last ship, it also ends the match with
 * the shooter as winner.
 */
export async function resolveShot(
  matchId: string, shotId: string, result: 'miss' | 'hit' | 'sunk',
  defenderUid: string, shooterUid: string, fleetSunk: boolean
): Promise<void> {
  const { sdk, db } = await fs()
  const batch = sdk.writeBatch(db)
  batch.update(sdk.doc(db, MATCHES, matchId, SHOTS, shotId), { result })
  batch.update(sdk.doc(db, MATCHES, matchId), {
    turn: defenderUid,
    updatedAt: sdk.serverTimestamp(),
    ...(fleetSunk ? { status: 'done', winner: shooterUid, endReason: 'fleet-sunk' } : {}),
  })
  await batch.commit()
}

/**
 * Ends the match early: `forfeit` when this player concedes (winner = the
 * opponent), `timeout` when abandoning a stale opponent (winner = whoever
 * stayed). Rewards flow from the winner field either way.
 */
export async function endMatch(matchId: string, winnerUid: string, reason: 'forfeit' | 'timeout'): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.updateDoc(sdk.doc(db, MATCHES, matchId), {
    status: 'done', winner: winnerUid, endReason: reason, updatedAt: sdk.serverTimestamp(),
  })
}

/** Live single-match subscription. `null` means the doc no longer exists. */
export function subscribeMatch(
  matchId: string, onChange: (match: Match | null) => void, onError: (err: unknown) => void
): () => void {
  let unsub: (() => void) | undefined
  let cancelled = false
  fs()
    .then(({ sdk, db }) => {
      if (cancelled) return
      unsub = sdk.onSnapshot(
        sdk.doc(db, MATCHES, matchId),
        (snap) => onChange(snap.exists() ? toMatch(matchId, snap.data()) : null),
        onError
      )
    })
    .catch(onError)
  return () => { cancelled = true; unsub?.() }
}

/** Live shot log for a match, in stable order. */
export function subscribeShots(
  matchId: string, onChange: (shots: Shot[]) => void, onError: (err: unknown) => void
): () => void {
  return subscribe(
    (sdk, db) => sdk.query(sdk.collection(db, MATCHES, matchId, SHOTS)),
    toShot,
    (shots) => onChange(sortShots(shots)),
    onError
  )
}

/** Live list of every match this player is part of (any status). */
export function subscribeMyMatches(
  uid: string, onChange: (matches: Match[]) => void, onError: (err: unknown) => void
): () => void {
  return subscribe(
    (sdk, db) => sdk.query(sdk.collection(db, MATCHES), sdk.where('players', 'array-contains', uid)),
    toMatch,
    (ms) => onChange(ms.sort((a, b) => b.createdAtMs - a.createdAtMs)),
    onError
  )
}
