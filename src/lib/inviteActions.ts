// Accepting and declining an invite, in one place.
//
// Two surfaces offer these: the pop-up that finds you mid-game, and the Friends
// list you come back to afterwards. They must agree — an invite accepted in one
// and still sitting in the other, or a decline that only half-happens, is the
// kind of bug that only shows up with two people and two devices. So the
// per-game branching lives here rather than being written out twice.
//
// The shared-table games (Ascend, the Card Game, Racer) all seat a player the
// same way; what differs — chairs and opening state — comes from TABLE_RULES
// (lib/gameTables.ts), so accepting an invite can never disagree with the
// lobby's own JOIN button about how a table is seated.
//
// The pure side of invites (what they are, when they expire) is lib/invites.ts.
import { acceptInvite, deleteInviteMatch } from './social'
import { joinRoom, leaveRoom } from './lsroom'
import { joinGameRoom, leaveGameRoom, type GameKind } from './gameroom'
import { tableRules } from './gameTables'
import type { GameInvite } from './invites'

/** Takes the seat and returns where to send the player. */
export async function acceptGameInvite(
  invite: GameInvite, me: { uid: string; name: string },
): Promise<string> {
  switch (invite.kind) {
    case 'battleship':
      await acceptInvite(invite.id)
      break
    case 'laststanding':
      await joinRoom(invite.id, me)
      break
    case 'ascend':
    case 'cardgame':
    case 'racer': {
      const rules = tableRules(invite.kind satisfies GameKind)
      await joinGameRoom(invite.id, me, rules.maxSeats, rules.seatState)
      break
    }
  }
  return invite.route
}

/** Removes the invite. Best effort: it expires by itself within three minutes. */
export async function declineGameInvite(invite: GameInvite, uid: string): Promise<void> {
  switch (invite.kind) {
    case 'battleship':
      await deleteInviteMatch(invite.id)
      break
    case 'laststanding':
      await leaveRoom(invite.id, uid)
      break
    case 'ascend':
    case 'cardgame':
    case 'racer': {
      const rules = tableRules(invite.kind satisfies GameKind)
      await leaveGameRoom(invite.id, uid, rules.maxSeats, rules.seatState)
      break
    }
  }
}
