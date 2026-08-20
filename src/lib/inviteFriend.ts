// Inviting a friend from the Friends list, to any game.
//
// Every game needs a topic before it can start, and the Friends page has no
// topic picker — so it doesn't try to be one. Picking a game there hands the
// friend off to that game's own setup screen through router state; that screen
// already knows how to choose a course and a subunit, and finishes by creating
// the table and inviting them into it.
//
// One key for the handoff, read the same way everywhere, so a new game joins by
// adding a row to INVITABLE rather than inventing its own convention.

/** Who to invite, carried from the Friends list to a game's setup screen.
 *  `name` is how the Friends list was already showing them, so the setup screen
 *  can name them without a second handle lookup; it may be missing. */
export interface InviteFriend { uid: string; email: string; name?: string }

/** The router-state key every game reads. */
export const INVITE_STATE_KEY = 'inviteFriend'

/** A game you can invite somebody to, and where its setup screen lives. */
export interface InvitableGame {
  key: string
  name: string
  /** What they'll be doing, so the picker isn't four bare names. */
  blurb: string
  route: string
  color: string
}

export const INVITABLE: readonly InvitableGame[] = [
  {
    key: 'battleship', name: 'Battleship', route: '/battleship', color: '#3df5ff',
    blurb: 'Solve to earn a shot at their fleet.',
  },
  {
    key: 'ascend', name: 'Ascend', route: '/ascend', color: '#3dffa2',
    blurb: 'Answer to earn a roll, first to the summit.',
  },
  {
    key: 'racer', name: 'Racer', route: '/racer', color: '#4d8dff',
    blurb: 'Right answers speed you up, wrong ones slow you down.',
  },
  {
    key: 'cardgame', name: 'Card Game', route: '/cardgame', color: '#7c3aff',
    blurb: 'Solve to play a card, first to empty their hand.',
  },
  {
    key: 'laststanding', name: 'Last Standing', route: '/laststanding', color: '#ff4d8d',
    blurb: 'Miss a question and lose a life. Last one left wins.',
  },
]

/**
 * Reads the friend a setup screen was opened for, or null on a normal visit.
 * Router state is untrusted enough to check: it survives a back button and a
 * restored session, so a malformed shape must not reach a Firestore write.
 */
export function friendFromState(state: unknown): InviteFriend | null {
  if (typeof state !== 'object' || state === null) return null
  const raw = (state as Record<string, unknown>)[INVITE_STATE_KEY]
  if (typeof raw !== 'object' || raw === null) return null
  const { uid, email, name } = raw as Record<string, unknown>
  if (typeof uid !== 'string' || uid.length === 0) return null
  return {
    uid,
    email: typeof email === 'string' ? email : '',
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
  }
}

/** What to call the friend on a setup screen: their handle if we were handed
 *  one, their address if not, and a neutral word if we have neither. */
export const inviteeLabel = (friend: InviteFriend): string =>
  friend.name || friend.email || 'your friend'

/** The router state to navigate with. */
export function inviteState(friend: InviteFriend): Record<string, InviteFriend> {
  return { [INVITE_STATE_KEY]: friend }
}
