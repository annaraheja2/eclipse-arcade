// One online table shape, shared by every turn-based cabinet.
//
// Last Standing grew its own rooms first (lib/lsroom.ts). Rather than copy that
// file per game, this is the same arrangement generalised: the document carries
// a `game` field naming the cabinet, and the game's own module owns the `state`
// inside it. Ascend and the Card Game therefore share one collection, one invite
// and one rules block, and a future turn-based game joins by adding a name to
// GameKind rather than another of these files.
//
// The trust model is Last Standing's, unchanged: every seated client replays the
// same pure reducer over the state in the document, so there is no separate
// online rule set to keep in step with the solo game. A client only commits a
// transition it owns, and `tick` must advance by exactly one, so a stale client's
// write loses instead of replaying a turn.
//
// REQUIRES the gameRooms block in firestore.rules to be published — until then
// every read and write here is denied. See docs/multiplayer-rules.md.
import { getFirebaseDb, isFirebaseConfigured } from './firebase'
import { toSelection, type Selection } from './social'

/** Which cabinet a table is for. Must match the list in firestore.rules. */
export type GameKind = 'ascend' | 'cardgame' | 'racer'
const GAME_KINDS: readonly GameKind[] = ['ascend', 'cardgame', 'racer']

export type RoomStatus = 'lobby' | 'active' | 'done'
const STATUSES: readonly RoomStatus[] = ['lobby', 'active', 'done']

/** The hard ceiling the rules enforce; each game may seat fewer. */
export const ROOM_MAX_SEATS = 6

export interface GameRoom {
  id: string
  game: GameKind
  host: string
  members: string[]
  invited: string[]
  names: Record<string, string>
  status: RoomStatus
  sel: Selection
  seed: number
  seatUids: (string | null)[]
  /** The game's own state. Narrow it with that game's module — this layer
   *  deliberately does not know the shape. */
  state: unknown
  tick: number
  turnStartedAtMs: number
  createdAtMs: number
  updatedAtMs: number
}

const COLL = 'gameRooms'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every(str)) return null
  return v as string[]
}

function millisOf(v: unknown): number {
  if (isRecord(v) && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis()
  }
  return 0
}

/** Narrows an untrusted room document, or null when it is malformed. */
export function toGameRoom(id: string, data: unknown): GameRoom | null {
  if (!isRecord(data)) return null
  const { game, host, status, seed, tick } = data
  if (!str(game) || !(GAME_KINDS as readonly string[]).includes(game)) return null
  if (!str(host)) return null
  if (!str(status) || !(STATUSES as readonly string[]).includes(status)) return null
  if (typeof seed !== 'number' || typeof tick !== 'number') return null
  const members = strList(data.members)
  const invited = strList(data.invited)
  if (!members || !invited || members.length === 0) return null
  const sel = toSelection(data.sel)
  if (!sel) return null

  const seatUids: (string | null)[] = Array.isArray(data.seatUids)
    ? data.seatUids.map((u) => (str(u) ? u : null))
    : []
  const names: Record<string, string> = {}
  if (isRecord(data.names)) {
    for (const [k, v] of Object.entries(data.names)) if (str(v)) names[k] = v
  }

  return {
    id, game: game as GameKind, host, members, invited, names,
    status: status as RoomStatus, sel, seed, seatUids,
    state: data.state,
    tick,
    turnStartedAtMs: millisOf(data.turnStartedAt),
    createdAtMs: millisOf(data.createdAt),
    updatedAtMs: millisOf(data.updatedAt),
  }
}

export const gameRoomsAvailable = (): boolean => isFirebaseConfigured

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

const selData = (s: Selection) => ({
  courseId: s.courseId, unitId: s.unitId, subunitId: s.subunitId, difficulty: s.difficulty,
})

/**
 * Seats for a member list: everyone at the table in join order, and no AI. The
 * seat index is what the game's state is indexed by.
 */
export function seatsFor(members: readonly string[], max: number): (string | null)[] {
  return members.slice(0, Math.min(max, ROOM_MAX_SEATS)).map((uid) => uid)
}

/** Opens a table in the lobby with the host alone at it. */
export async function createGameRoom(
  game: GameKind,
  me: { uid: string; name: string },
  sel: Selection,
  seed: number,
  initialState: (seatCount: number) => Record<string, unknown>,
): Promise<string> {
  const { sdk, db } = await fs()
  const ref = await sdk.addDoc(sdk.collection(db, COLL), {
    game,
    host: me.uid,
    members: [me.uid],
    invited: [],
    names: { [me.uid]: me.name },
    status: 'lobby',
    sel: selData(sel),
    seed,
    seatUids: [me.uid],
    state: initialState(1),
    tick: 0,
    turnStartedAt: null,
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  })
  return ref.id
}

/** Host adds a friend to the invite list. */
export async function inviteToGameRoom(roomId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.updateDoc(sdk.doc(db, COLL, roomId), {
    invited: sdk.arrayUnion(uid),
    updatedAt: sdk.serverTimestamp(),
  })
}

/**
 * An invited player takes a seat. Transactional, so two friends accepting at the
 * same moment can't overflow the table or land on the same chair.
 */
export async function joinGameRoom(
  roomId: string,
  me: { uid: string; name: string },
  maxSeats: number,
  reseat: (seatCount: number, room: GameRoom) => Record<string, unknown>,
): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, COLL, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toGameRoom(roomId, snap.data()) : null
    if (!room) throw new Error('That table is no longer available.')
    if (room.status !== 'lobby') throw new Error('That game has already started.')
    if (room.members.includes(me.uid)) return
    if (room.members.length >= Math.min(maxSeats, ROOM_MAX_SEATS)) throw new Error('That table is full.')
    const members = [...room.members, me.uid]
    tx.update(ref, {
      members,
      names: { ...room.names, [me.uid]: me.name },
      invited: room.invited.filter((u) => u !== me.uid),
      seatUids: seatsFor(members, maxSeats),
      state: reseat(members.length, room),
      updatedAt: sdk.serverTimestamp(),
    })
  })
}

/** Decline an invite, or leave a lobby you joined. The host leaving closes it. */
export async function leaveGameRoom(
  roomId: string,
  uid: string,
  maxSeats: number,
  reseat: (seatCount: number, room: GameRoom) => Record<string, unknown>,
): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, COLL, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toGameRoom(roomId, snap.data()) : null
    if (!room) return
    if (room.host === uid) { tx.delete(ref); return }
    const members = room.members.filter((u) => u !== uid)
    const names = { ...room.names }
    delete names[uid]
    tx.update(ref, {
      members,
      names,
      invited: room.invited.filter((u) => u !== uid),
      // Re-seating mid-race would scramble everyone's progress, so only a lobby
      // leave re-seats; someone who walks out of a live game keeps their chair.
      ...(room.status === 'lobby'
        ? { seatUids: seatsFor(members, maxSeats), state: reseat(Math.max(1, members.length), room) }
        : {}),
      updatedAt: sdk.serverTimestamp(),
    })
  })
}

/** Host starts the game. */
export async function startGameRoom(roomId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, COLL, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toGameRoom(roomId, snap.data()) : null
    if (!room) throw new Error('That table is no longer available.')
    if (room.host !== uid) throw new Error('Only the host can start the game.')
    if (room.status !== 'lobby') return
    tx.update(ref, {
      status: 'active',
      turnStartedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    })
  })
}

/**
 * Applies one transition. `expectedTick` is the tick the caller computed from:
 * if the table has moved on, the write is dropped rather than replaying a turn
 * two clients both tried to resolve. Returns whether it landed.
 */
export async function commitGameTransition(
  roomId: string,
  expectedTick: number,
  nextState: Record<string, unknown>,
  done: boolean,
): Promise<boolean> {
  const { sdk, db } = await fs()
  return sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, COLL, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toGameRoom(roomId, snap.data()) : null
    if (!room || room.status !== 'active' || room.tick !== expectedTick) return false
    tx.update(ref, {
      state: nextState,
      tick: expectedTick + 1,
      status: done ? 'done' : 'active',
      turnStartedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    })
    return true
  })
}

/** Closing the table — the host's alone. */
export async function deleteGameRoom(roomId: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.deleteDoc(sdk.doc(db, COLL, roomId))
}

// ---------------------------------------------------------------------------
// Card Game: hands nobody else may read
// ---------------------------------------------------------------------------
//
// The room document is readable by everyone at the table, so a hand kept there
// is a hand everyone can read. Each player's cards live in their own document
// instead, and the rules let only its owner read it (firestore.rules -> hands).
//
// The host deals, because dealing has to happen somewhere and there is no
// server — so the host sees the deal as they make it, even though the rules stop
// them reading it back. Rotating who hosts spreads that around; closing it
// properly would mean dealing server-side. See docs/multiplayer-rules.md.

/** The host deals: one write per seat, all in one batch so a half-dealt table
 *  can't happen. */
export async function dealHands(
  roomId: string, hands: ReadonlyArray<{ uid: string; data: Record<string, unknown> }>,
): Promise<void> {
  const { sdk, db } = await fs()
  const batch = sdk.writeBatch(db)
  for (const h of hands) {
    batch.set(sdk.doc(db, COLL, roomId, 'hands', h.uid), h.data)
  }
  await batch.commit()
}

/** Overwrites MY hand. The rules refuse this for anyone else's. */
export async function writeMyHand(
  roomId: string, uid: string, data: Record<string, unknown>,
): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.setDoc(sdk.doc(db, COLL, roomId, 'hands', uid), data)
}

/** My own hand, live. Reading anyone else's is denied by the rules. */
export function subscribeMyHand<T>(
  roomId: string,
  uid: string,
  read: (data: unknown) => T | null,
  onHand: (hand: T | null) => void,
  onError: (err: unknown) => void,
): () => void {
  let stop = () => {}
  let cancelled = false
  void fs().then(({ sdk, db }) => {
    if (cancelled) return
    stop = sdk.onSnapshot(
      sdk.doc(db, COLL, roomId, 'hands', uid),
      (snap: { exists: () => boolean; data: () => unknown }) => {
        onHand(snap.exists() ? read(snap.data()) : null)
      },
      onError,
    )
  }).catch(onError)
  return () => { cancelled = true; stop() }
}

// ---------------------------------------------------------------------------
// Racer: one document per driver, rather than one shared state
// ---------------------------------------------------------------------------
//
// The turn-based games advance a single `state` a tick at a time. Racer can't:
// four cars move at once, and four clients writing the same document once a
// second would fight each other. So each driver owns a document under the room
// and writes only their own. See lib/racerRoom.ts for what fills the gaps
// between updates.

/** Publishes where MY car is. Overwrites my own document, nobody else's. */
export async function publishRacerProgress(
  roomId: string, uid: string, data: Record<string, unknown>,
): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.setDoc(sdk.doc(db, COLL, roomId, 'racers', uid), data)
}

/** The whole field, live. `read` maps each document to whatever the caller wants. */
export function subscribeRacers<T>(
  roomId: string,
  read: (uid: string, data: unknown) => T | null,
  onRacers: (rows: T[]) => void,
  onError: (err: unknown) => void,
): () => void {
  let stop = () => {}
  let cancelled = false
  void fs().then(({ sdk, db }) => {
    if (cancelled) return
    stop = sdk.onSnapshot(
      sdk.collection(db, COLL, roomId, 'racers'),
      (snap: { docs: Array<{ id: string; data: () => unknown }> }) => {
        const rows: T[] = []
        for (const d of snap.docs) {
          const row = read(d.id, d.data())
          if (row) rows.push(row)
        }
        onRacers(rows)
      },
      onError,
    )
  }).catch(onError)
  return () => { cancelled = true; stop() }
}

export function subscribeGameRoom(
  roomId: string,
  onRoom: (room: GameRoom | null) => void,
  onError: (err: unknown) => void,
): () => void {
  let stop = () => {}
  let cancelled = false
  void fs().then(({ sdk, db }) => {
    if (cancelled) return
    stop = sdk.onSnapshot(
      sdk.doc(db, COLL, roomId),
      (snap) => onRoom(snap.exists() ? toGameRoom(roomId, snap.data()) : null),
      onError,
    )
  }).catch(onError)
  return () => { cancelled = true; stop() }
}

/**
 * Tables I am at or invited to. Two queries, because Firestore cannot OR across
 * different array fields — the same shape subscribeMyRooms uses.
 */
export function subscribeMyGameRooms(
  uid: string,
  onRooms: (rooms: GameRoom[]) => void,
  onError: (err: unknown) => void,
): () => void {
  let unsubs: Array<() => void> = []
  let cancelled = false
  const mine = new Map<string, GameRoom>()
  const invitedTo = new Map<string, GameRoom>()

  const emit = () => {
    const all = [...mine.values(), ...invitedTo.values()]
    const byId = new Map(all.map((r) => [r.id, r]))
    onRooms([...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs))
  }

  void fs().then(({ sdk, db }) => {
    if (cancelled) return
    const watch = (field: 'members' | 'invited', into: Map<string, GameRoom>) =>
      sdk.onSnapshot(
        sdk.query(sdk.collection(db, COLL), sdk.where(field, 'array-contains', uid)),
        (snap: { docs: Array<{ id: string; data: () => unknown }> }) => {
          into.clear()
          for (const d of snap.docs) {
            const room = toGameRoom(d.id, d.data())
            if (room) into.set(room.id, room)
          }
          emit()
        },
        onError,
      )
    unsubs = [watch('members', mine), watch('invited', invitedTo)]
  }).catch(onError)

  return () => { cancelled = true; for (const u of unsubs) u() }
}
