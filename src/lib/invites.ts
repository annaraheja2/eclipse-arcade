// One invite concept for the whole arcade.
//
// Today two games can be played with a friend, and each grew its own invite:
// Battleship creates a `matches` doc with status 'invite', Last Standing adds
// your uid to a room's `invited` array. A player shouldn't have to care which.
// This module normalises both into a GameInvite so the pop-up, the Friends list,
// and the expiry rule are written once — and so a third game joins by adding an
// adapter here, not another notification.
//
// Pure. The Firestore subscriptions stay in lib/social.ts and lib/lsroom.ts, and
// components/InviteToast.tsx owns the React side.
import type { Match } from './social'
import type { LsRoom } from './lsroom'

/** Which game the invite is for. Adding a game means adding a case here. */
export type InviteKind = 'battleship' | 'laststanding'

export interface GameInvite {
  /** The match or room id — unique per invite, so it doubles as the React key. */
  id: string
  kind: InviteKind
  /** Shown to the invitee: "NOVA invited you to Battleship". */
  gameName: string
  /** uid of whoever sent it, for the "who is this from" line. */
  fromUid: string
  /** When the invite was raised. Expiry is measured from here. */
  invitedAtMs: number
  /** Where accepting takes them. */
  route: string
}

/** How long an invite stays joinable. It keeps its place in the Friends list
 *  this whole time, so someone mid-game can come back to it. */
export const INVITE_TTL_MS = 3 * 60_000

/** How long the pop-up itself stays on screen before withdrawing. Deliberately
 *  much shorter than the TTL: the banner is an interruption, the Friends entry
 *  is the record. */
export const TOAST_MS = 20_000

/** Milliseconds until this invite stops being joinable; 0 once it has. */
export function msLeft(invite: GameInvite, nowMs: number): number {
  return Math.max(0, invite.invitedAtMs + INVITE_TTL_MS - nowMs)
}

export function isExpired(invite: GameInvite, nowMs: number): boolean {
  return msLeft(invite, nowMs) === 0
}

/** Whole minutes:seconds left, for the countdown on the card. */
export function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Still-joinable invites, newest first. */
export function liveInvites(invites: readonly GameInvite[], nowMs: number): GameInvite[] {
  return invites.filter((i) => !isExpired(i, nowMs)).sort((a, b) => b.invitedAtMs - a.invitedAtMs)
}

/**
 * A Battleship friend invite, or null when this match isn't one aimed at me.
 * players[0] is the inviter, so a match I created is never an invite TO me.
 * The doc is created by the invite itself, so createdAt IS the invite time.
 */
export function fromMatch(match: Match, myUid: string): GameInvite | null {
  if (match.status !== 'invite') return null
  if (match.players[0] === myUid) return null
  if (!match.players.includes(myUid)) return null
  return {
    id: match.id,
    kind: 'battleship',
    gameName: 'Battleship',
    fromUid: match.players[0],
    invitedAtMs: match.createdAtMs,
    route: `/battleship/pvp/${match.id}`,
  }
}

/**
 * A Last Standing table invite, or null when I'm not on this room's invite list.
 *
 * A room carries no per-invite timestamp — `invited` is a bare array of uids —
 * so a lobby's `updatedAt` stands in: while a table is still filling, the only
 * things that touch it are invites and joins, which makes it a close read on
 * when the invite went out. (An exact stamp would need a new field, and the
 * Firestore rules pin this document's field list.)
 */
export function fromRoom(room: LsRoom, myUid: string): GameInvite | null {
  if (room.status !== 'lobby') return null
  if (!room.invited.includes(myUid)) return null
  return {
    id: room.id,
    kind: 'laststanding',
    gameName: 'Last Standing',
    fromUid: room.host,
    invitedAtMs: room.updatedAtMs || room.createdAtMs,
    route: `/laststanding/room/${room.id}`,
  }
}

/** Both sources, normalised and filtered to what's still joinable. */
export function collectInvites(
  matches: readonly Match[], rooms: readonly LsRoom[], myUid: string, nowMs: number,
): GameInvite[] {
  const all = [
    ...matches.map((m) => fromMatch(m, myUid)),
    ...rooms.map((r) => fromRoom(r, myUid)),
  ].filter((i): i is GameInvite => i !== null)
  return liveInvites(all, nowMs)
}
