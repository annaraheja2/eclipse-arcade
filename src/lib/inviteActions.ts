// Accepting and declining an invite, in one place.
//
// Two surfaces offer these: the pop-up that finds you mid-game, and the Friends
// list you come back to afterwards. They must agree — an invite accepted in one
// and still sitting in the other, or a decline that only half-happens, is the
// kind of bug that only shows up with two people and two devices. So the
// per-game branching lives here rather than being written out twice.
//
// The pure side of invites (what they are, when they expire) is lib/invites.ts.
import { acceptInvite, deleteInviteMatch } from './social'
import { joinRoom, leaveRoom } from './lsroom'
import { joinGameRoom, leaveGameRoom } from './gameroom'
import { createAscendState, ascendStateData, MAX_SEATS as ASCEND_SEATS } from './ascendRoom'
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
      await joinGameRoom(invite.id, me, ASCEND_SEATS,
        (seats) => ascendStateData(createAscendState(seats)))
      break
    case 'cardgame':
      // No table implementation yet, so nothing can create one of these — but
      // failing loudly beats navigating to a route that does not exist.
      throw new Error('Card Game tables are not available yet.')
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
      await leaveGameRoom(invite.id, uid, ASCEND_SEATS,
        (seats) => ascendStateData(createAscendState(seats)))
      break
  }
}
