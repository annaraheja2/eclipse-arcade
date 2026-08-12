// Online Last Standing — friends share one table.
//
// The whole point of this module is that it adds NO rules. lib/laststanding.ts
// is already a pure, serialisable reducer, so a room doc just carries the
// LsState and every client replays the same transitions locally. What lives
// here is the sync layer: who holds which seat, whose client is allowed to
// write the next transition, and how a stale write is rejected.
//
// TRUST MODEL (mirrors PvP Battleship: no game server).
//   * The player on turn reports their OWN answer. A cheater can only claim
//     their own question was right — the same latitude Battleship's shooter
//     has. Nobody can touch another seat's lives.
//   * The HOST is the janitor: it runs AI turns, picks an AI winner's banish,
//     and force-times-out a player who has gone silent past the grace window,
//     so one disconnect can't freeze the table forever.
//   * Every transition carries `tick`, the count of transitions applied so far.
//     A write only lands if the tick it was computed from is still current, so
//     two clients resolving the same turn can't both apply it.
//
// CLOCK: `turnStartedAt` is a server timestamp, so the countdown is anchored to
// Firestore rather than to any one device. It reads back null while the write
// is still in flight, so callers fall back to their local clock for that beat.
// Cross-device skew therefore only really affects the host's timeout backstop,
// which is why the grace window below is generous.

import {
  SEAT_COUNT, LIVES, timeForTurn, isAlive,
  type LsState, type Seat,
} from './laststanding'
import type { Selection } from './social'
import { toSelection } from './social'
import { isFirebaseConfigured, getFirebaseDb } from './firebase'

export const MAX_SEATS = SEAT_COUNT
/** How long past a player's own clock the host waits before timing them out. */
export const TIMEOUT_GRACE_MS = 6000
/** Names for seats no human claimed. */
export const ROOM_AI_NAMES = ['NOVA', 'VEGA', 'ORION', 'ATLAS'] as const

export type RoomStatus = 'lobby' | 'active' | 'done'

export interface LsRoom {
  id: string
  host: string // uid
  members: string[] // joined humans, host first — at most MAX_SEATS
  invited: string[] // invited uids that have not joined (or declined) yet
  names: Record<string, string> // uid -> display name shown on the seat
  status: RoomStatus
  sel: Selection // the host's topic pick — everyone answers the same pool
  seed: number // shared question-order seed
  seatUids: (string | null)[] // seat index -> uid, or null for an AI seat
  state: LsState
  tick: number // transitions applied — the optimistic lock
  turnStartedAtMs: number // 0 while the server timestamp is still in flight
  createdAtMs: number
  updatedAtMs: number
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): v is string => typeof v === 'string'
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

function millisOf(v: unknown): number {
  if (isRecord(v) && typeof v.toMillis === 'function') {
    const n = (v.toMillis as () => unknown)()
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return 0
}

/**
 * Seats for a room: the joined humans in join order, then AI for every empty
 * chair so the table is always full. Returns the state plus the seat→uid map
 * the room needs to route "is it my turn".
 */
export function buildRoomSeats(members: readonly { uid: string; name: string }[]): {
  state: LsState
  seatUids: (string | null)[]
} {
  const humans = members.slice(0, MAX_SEATS)
  const seats: Seat[] = []
  const seatUids: (string | null)[] = []
  for (let i = 0; i < MAX_SEATS; i++) {
    const human = humans[i]
    seats.push({
      seat: i,
      name: human ? human.name : ROOM_AI_NAMES[(i - humans.length) % ROOM_AI_NAMES.length],
      kind: human ? 'human' : 'ai',
      lives: LIVES,
      turnsTaken: 0,
      inLobby: true,
    })
    seatUids.push(human ? human.uid : null)
  }
  return { state: { seats, round: 1, turn: 0, phase: { kind: 'turn' } }, seatUids }
}

/** Seat index this uid holds, or -1 if they hold none. */
export function seatOfUid(room: LsRoom, uid: string): number {
  return room.seatUids.findIndex((u) => u === uid)
}

export const isHost = (room: LsRoom, uid: string): boolean => room.host === uid

/** True when the seat on turn belongs to this uid and the game wants an answer. */
export function isMyTurn(room: LsRoom, uid: string): boolean {
  return room.status === 'active'
    && room.state.phase.kind === 'turn'
    && room.seatUids[room.state.turn] === uid
}

/** True when this uid won the round and owes the table a banish pick. */
export function isMyBanish(room: LsRoom, uid: string): boolean {
  return room.status === 'active'
    && room.state.phase.kind === 'banish'
    && room.seatUids[room.state.phase.winner] === uid
}

/**
 * Deterministic question pick so every client shows the SAME question for a
 * given turn. A cheap integer mix of the room seed and the transition count —
 * no shared RNG object to keep in step, just a pure function of (seed, tick).
 */
export function questionIndexFor(seed: number, tick: number, poolSize: number): number {
  if (poolSize <= 0) return 0
  let h = (seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  // `^` yields a SIGNED 32-bit int, so the final mix must be coerced back to
  // unsigned — otherwise this returns a negative index for some seeds.
  return ((h ^ (h >>> 16)) >>> 0) % poolSize
}

/**
 * Whole seconds left on the current turn, floored at 0. `startedAtMs` of 0
 * means the server stamp has not landed yet, so the caller's `fallbackStart`
 * (its own clock, set when it first saw the turn) carries the countdown.
 */
export function secondsLeftFor(room: LsRoom, nowMs: number, fallbackStartMs: number): number {
  const seat = room.state.seats[room.state.turn]
  if (!seat) return 0
  const total = timeForTurn(seat.turnsTaken)
  const started = room.turnStartedAtMs || fallbackStartMs
  return Math.max(0, Math.ceil(total - (nowMs - started) / 1000))
}

/**
 * Whether the HOST should step in and resolve the current turn: an AI seat is
 * up, or a human seat has blown through its clock plus the grace window. Pure,
 * so the host's caretaker effect is trivially testable.
 */
export function hostShouldResolveTurn(room: LsRoom, nowMs: number, fallbackStartMs: number): boolean {
  if (room.status !== 'active' || room.state.phase.kind !== 'turn') return false
  const seat = room.state.seats[room.state.turn]
  if (!seat || !isAlive(seat)) return false
  if (room.seatUids[room.state.turn] === null) return true // AI seat
  const started = room.turnStartedAtMs || fallbackStartMs
  return nowMs - started > timeForTurn(seat.turnsTaken) * 1000 + TIMEOUT_GRACE_MS
}

/** Whether the host owes the table an AI winner's banish pick. */
export function hostShouldBanish(room: LsRoom, uid: string): boolean {
  if (room.status !== 'active' || room.state.phase.kind !== 'banish') return false
  if (!isHost(room, uid)) return false
  return room.seatUids[room.state.phase.winner] === null
}

/** Placement (1 = champion) for a seat once the game is done. */
export function placementOf(state: LsState, seat: number): number {
  if (state.phase.kind !== 'champion') return 0
  if (state.phase.champion === seat) return 1
  // Everyone else placed in reverse banish order; inLobby seats outlasted the
  // banished ones. Without a per-seat exit log the runner-up ordering is the
  // seat's own standing, which is all the score curve needs.
  const out = state.seats.filter((s) => !s.inLobby).length
  return state.seats[seat]?.inLobby ? 2 : out + 1
}

// ---- narrowing untrusted docs ---------------------------------------------

function toSeat(v: unknown): Seat | null {
  if (!isRecord(v)) return null
  const { seat, name, kind, lives, turnsTaken, inLobby } = v
  if (!int(seat) || seat < 0 || seat >= MAX_SEATS) return null
  if (!str(name)) return null
  if (kind !== 'human' && kind !== 'ai') return null
  if (!int(lives) || lives < 0 || lives > LIVES) return null
  if (!int(turnsTaken) || turnsTaken < 0) return null
  if (typeof inLobby !== 'boolean') return null
  return { seat, name, kind, lives, turnsTaken, inLobby }
}

function toPhase(v: unknown, seatCount: number): LsState['phase'] | null {
  if (!isRecord(v)) return null
  if (v.kind === 'turn') return { kind: 'turn' }
  const inRange = (n: unknown): n is number => int(n) && n >= 0 && n < seatCount
  if (v.kind === 'banish' && inRange(v.winner)) return { kind: 'banish', winner: v.winner }
  if (v.kind === 'champion' && inRange(v.champion)) return { kind: 'champion', champion: v.champion }
  return null
}

function toState(v: unknown): LsState | null {
  if (!isRecord(v) || !Array.isArray(v.seats)) return null
  const seats: Seat[] = []
  for (const raw of v.seats) {
    const seat = toSeat(raw)
    if (!seat) return null
    seats.push(seat)
  }
  if (seats.length !== MAX_SEATS) return null
  if (!int(v.round) || v.round < 1) return null
  if (!int(v.turn) || v.turn < 0 || v.turn >= seats.length) return null
  const phase = toPhase(v.phase, seats.length)
  if (!phase) return null
  return { seats, round: v.round, turn: v.turn, phase }
}

const strList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every(str) ? (v as string[]) : null

/** Narrows an untrusted room doc, or null when malformed. Rebuilds from known
 *  fields only, so nothing unexpected in the doc reaches game state. */
export function toRoom(id: string, data: unknown): LsRoom | null {
  if (!isRecord(data)) return null
  const { host, status, seed, tick } = data
  if (!str(host)) return null
  if (status !== 'lobby' && status !== 'active' && status !== 'done') return null
  if (!int(seed) || !int(tick) || tick < 0) return null
  const members = strList(data.members)
  const invited = strList(data.invited)
  if (!members || !invited || members.length === 0) return null
  const sel = toSelection(data.sel)
  if (!sel) return null
  const state = toState(data.state)
  if (!state) return null
  if (!Array.isArray(data.seatUids) || data.seatUids.length !== MAX_SEATS) return null
  const seatUids: (string | null)[] = []
  for (const u of data.seatUids) {
    if (u !== null && !str(u)) return null
    seatUids.push(u)
  }
  const names: Record<string, string> = {}
  if (isRecord(data.names)) {
    for (const [k, v] of Object.entries(data.names)) if (str(v)) names[k] = v
  }
  return {
    id, host, members, invited, names, status, sel, seed, seatUids, state, tick,
    turnStartedAtMs: millisOf(data.turnStartedAt),
    createdAtMs: millisOf(data.createdAt),
    updatedAtMs: millisOf(data.updatedAt),
  }
}

/** Firestore-safe copy of a state (plain objects, no undefined). */
function stateData(state: LsState): LsState {
  return {
    seats: state.seats.map((s) => ({
      seat: s.seat, name: s.name, kind: s.kind,
      lives: s.lives, turnsTaken: s.turnsTaken, inLobby: s.inLobby,
    })),
    round: state.round,
    turn: state.turn,
    phase: state.phase.kind === 'banish' ? { kind: 'banish', winner: state.phase.winner }
      : state.phase.kind === 'champion' ? { kind: 'champion', champion: state.phase.champion }
      : { kind: 'turn' },
  }
}

// ---------------------------------------------------------------------------
// Firestore boundary
// ---------------------------------------------------------------------------

const ROOMS = 'lsRooms'

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

export const roomsAvailable = (): boolean => isFirebaseConfigured

/** Opens a room in the lobby with the host alone at the table. */
export async function createRoom(
  me: { uid: string; name: string }, sel: Selection, seed: number
): Promise<string> {
  const { sdk, db } = await fs()
  const { state, seatUids } = buildRoomSeats([me])
  const ref = await sdk.addDoc(sdk.collection(db, ROOMS), {
    host: me.uid,
    members: [me.uid],
    invited: [],
    names: { [me.uid]: me.name },
    status: 'lobby',
    sel: { courseId: sel.courseId, unitId: sel.unitId, subunitId: sel.subunitId, difficulty: sel.difficulty },
    seed,
    seatUids,
    state: stateData(state),
    tick: 0,
    turnStartedAt: null,
    createdAt: sdk.serverTimestamp(),
    updatedAt: sdk.serverTimestamp(),
  })
  return ref.id
}

/** Host adds a friend to the invite list. */
export async function inviteToRoom(roomId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.updateDoc(sdk.doc(db, ROOMS, roomId), {
    invited: sdk.arrayUnion(uid),
    updatedAt: sdk.serverTimestamp(),
  })
}

/**
 * An invited player takes a seat. Transactional so two friends accepting at
 * once can't overflow the table or land on the same chair.
 */
export async function joinRoom(roomId: string, me: { uid: string; name: string }): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, ROOMS, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toRoom(roomId, snap.data()) : null
    if (!room) throw new Error('That room is no longer available.')
    if (room.status !== 'lobby') throw new Error('That game has already started.')
    if (room.members.includes(me.uid)) return
    if (room.members.length >= MAX_SEATS) throw new Error('That table is full.')
    const members = [...room.members, me.uid]
    const names = { ...room.names, [me.uid]: me.name }
    const { state, seatUids } = buildRoomSeats(members.map((uid) => ({ uid, name: names[uid] ?? 'PLAYER' })))
    tx.update(ref, {
      members,
      names,
      invited: room.invited.filter((u) => u !== me.uid),
      seatUids,
      state: stateData(state),
      updatedAt: sdk.serverTimestamp(),
    })
  })
}

/** Decline an invite, or leave a lobby you joined. */
export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, ROOMS, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toRoom(roomId, snap.data()) : null
    if (!room) return
    if (room.host === uid) { tx.delete(ref); return } // host leaving closes the room
    const members = room.members.filter((u) => u !== uid)
    const names = { ...room.names }
    delete names[uid]
    const { state, seatUids } = buildRoomSeats(members.map((u) => ({ uid: u, name: names[u] ?? 'PLAYER' })))
    tx.update(ref, {
      members,
      names,
      invited: room.invited.filter((u) => u !== uid),
      // Re-seating mid-game would scramble lives, so a leaver mid-game keeps
      // their chair and simply times out; only a lobby leave re-seats.
      ...(room.status === 'lobby' ? { seatUids, state: stateData(state) } : {}),
      updatedAt: sdk.serverTimestamp(),
    })
  })
}

/** Host starts the game; the first turn's clock begins now. */
export async function startRoom(roomId: string, uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, ROOMS, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toRoom(roomId, snap.data()) : null
    if (!room) throw new Error('That room is no longer available.')
    if (room.host !== uid) throw new Error('Only the host can start the game.')
    if (room.status !== 'lobby') return
    tx.update(ref, { status: 'active', turnStartedAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() })
  })
}

/**
 * Applies one transition. `expectedTick` is the tick the caller computed from:
 * if the room has moved on, the write is dropped rather than double-applying a
 * turn two clients both tried to resolve.
 */
export async function commitTransition(
  roomId: string, expectedTick: number, next: LsState
): Promise<boolean> {
  const { sdk, db } = await fs()
  return sdk.runTransaction(db, async (tx) => {
    const ref = sdk.doc(db, ROOMS, roomId)
    const snap = await tx.get(ref)
    const room = snap.exists() ? toRoom(roomId, snap.data()) : null
    if (!room || room.status !== 'active') return false
    if (room.tick !== expectedTick) return false // someone else already resolved it
    tx.update(ref, {
      state: stateData(next),
      tick: expectedTick + 1,
      status: next.phase.kind === 'champion' ? 'done' : 'active',
      turnStartedAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    })
    return true
  })
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.deleteDoc(sdk.doc(db, ROOMS, roomId))
}

export function subscribeRoom(
  roomId: string,
  onChange: (room: LsRoom | null) => void,
  onError: (err: unknown) => void
): () => void {
  let unsub: (() => void) | undefined
  let cancelled = false
  fs().then(({ sdk, db }) => {
    if (cancelled) return
    unsub = sdk.onSnapshot(
      sdk.doc(db, ROOMS, roomId),
      (snap) => onChange(snap.exists() ? toRoom(roomId, snap.data()) : null),
      onError
    )
  }).catch(onError)
  return () => { cancelled = true; unsub?.() }
}

/** Rooms I am in or invited to — the entry list on the Last Standing landing. */
export function subscribeMyRooms(
  uid: string,
  onChange: (rooms: LsRoom[]) => void,
  onError: (err: unknown) => void
): () => void {
  let unsubs: (() => void)[] = []
  let cancelled = false
  const mine = new Map<string, LsRoom>()
  const invitedTo = new Map<string, LsRoom>()
  const emit = () => {
    const all = [...mine.values(), ...invitedTo.values()]
    const byId = new Map(all.map((r) => [r.id, r]))
    onChange([...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs))
  }
  fs().then(({ sdk, db }) => {
    if (cancelled) return
    const watch = (field: 'members' | 'invited', into: Map<string, LsRoom>) =>
      sdk.onSnapshot(
        sdk.query(sdk.collection(db, ROOMS), sdk.where(field, 'array-contains', uid)),
        (snap) => {
          into.clear()
          snap.forEach((d) => {
            const room = toRoom(d.id, d.data())
            if (room) into.set(room.id, room)
          })
          emit()
        },
        onError
      )
    unsubs = [watch('members', mine), watch('invited', invitedTo)]
  }).catch(onError)
  return () => { cancelled = true; for (const u of unsubs) u() }
}
