// The invite pop-up: a friend's invitation finds you wherever you are in the
// arcade, not only if you happen to open the Friends page.
//
// Two timers, deliberately different (see lib/invites.ts):
//   * the banner withdraws after TOAST_MS (20s) — it's an interruption
//   * the invite stays joinable for INVITE_TTL_MS (3 min) and keeps its place
//     in the Friends list, so someone who was mid-game can still come back
//
// Mounted once in App, so it needs its own subscriptions rather than props.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import { subscribeMyMatches, type Match } from '../lib/social'
import { subscribeMyRooms, type LsRoom } from '../lib/lsroom'
import { subscribeMyGameRooms, gameRoomsAvailable, type GameRoom } from '../lib/gameroom'
import { acceptGameInvite, declineGameInvite } from '../lib/inviteActions'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor, seatName } from '../lib/username'
import {
  collectInvites, formatLeft, msLeft, TOAST_MS, type GameInvite,
} from '../lib/invites'

const ACCENT = '#3df5ff'

export default function InviteToast() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.uid ?? null

  const [matches, setMatches] = useState<Match[]>([])
  const [rooms, setRooms] = useState<LsRoom[]>([])
  const [gameRooms, setGameRooms] = useState<GameRoom[]>([])
  // Re-render on a timer so the countdown ticks and an expired invite leaves on
  // its own, without waiting for a Firestore change.
  const [now, setNow] = useState(() => Date.now())
  // Invites this session has already shown, answered, or waved past. Keyed by
  // invite id so a re-render never resurrects a banner.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shownAtRef = useRef<{ id: string; at: number } | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured || !uid) { setMatches([]); setRooms([]); setGameRooms([]); return }
    const onError = (err: unknown) => console.error('[eclipse-arcade] invite feed failed:', err)
    const u1 = subscribeMyMatches(uid, setMatches, onError)
    const u2 = subscribeMyRooms(uid, setRooms, onError)
    // Denied until the gameRooms rules are published — a permission error here
    // must not take the other two feeds down with it.
    const u3 = gameRoomsAvailable()
      ? subscribeMyGameRooms(uid, setGameRooms, (err) => {
        console.warn('[eclipse-arcade] shared tables unavailable (rules not published?):', err)
        setGameRooms([])
      })
      : () => {}
    return () => { u1(); u2(); u3() }
  }, [uid])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const invites = useMemo(
    () => (uid ? collectInvites(matches, rooms, gameRooms, uid, now) : []),
    [matches, rooms, gameRooms, uid, now],
  )
  // Newest first; show one at a time so the banner can't tile down the screen.
  const invite = invites.find((i) => !dismissed.has(i.id)) ?? null

  // Start the 20-second clock the moment a banner appears, and withdraw it when
  // that runs out. The invite itself stays alive in the Friends list.
  useEffect(() => {
    if (!invite) { shownAtRef.current = null; return }
    if (shownAtRef.current?.id !== invite.id) shownAtRef.current = { id: invite.id, at: Date.now() }
    const elapsed = Date.now() - shownAtRef.current.at
    const id = window.setTimeout(
      () => setDismissed((d) => new Set(d).add(invite.id)),
      Math.max(0, TOAST_MS - elapsed),
    )
    return () => window.clearTimeout(id)
  }, [invite])

  // Both the sender (to name them on the card) and me (accepting writes my name
  // into the room, and looking up only the sender would leave mine unresolved
  // and fall back to my raw email).
  const uids = useMemo(
    () => (invite ? [invite.fromUid, ...(uid ? [uid] : [])] : []),
    [invite, uid],
  )
  const usernames = useUsernames(uids)

  const dismiss = useCallback((id: string) => {
    setDismissed((d) => new Set(d).add(id))
    setError('')
  }, [])

  async function accept(i: GameInvite) {
    if (busy || !uid) return
    setBusy(true)
    setError('')
    try {
      const name = seatName(usernames[uid], user?.email ?? null)
      const route = await acceptGameInvite(i, { uid, name })
      dismiss(i.id)
      navigate(route)
    } catch (err) {
      console.error('[eclipse-arcade] accepting an invite failed:', err)
      setError('Could not join — check your connection and try from the Friends page.')
    } finally {
      setBusy(false)
    }
  }

  async function decline(i: GameInvite) {
    if (busy || !uid) return
    setBusy(true)
    // The banner goes immediately: declining should feel instant even if the
    // write is still in flight.
    dismiss(i.id)
    try {
      await declineGameInvite(i, uid)
    } catch (err) {
      // Nothing to surface — the invite is gone from this player's view either
      // way, and it expires on its own within three minutes.
      console.error('[eclipse-arcade] declining an invite failed:', err)
    } finally {
      setBusy(false)
    }
  }

  if (!invite) return null

  const from = displayNameFor(usernames[invite.fromUid], null)
  const left = formatLeft(msLeft(invite, now))

  return (
    <div className="invite-toast" role="alert" aria-live="assertive">
      <div className="invite-card">
        <div className="min-w-0 flex-1">
          <p className="font-pixel text-[9px] tracking-[0.16em]" style={{ color: ACCENT }}>
            INVITE · {invite.gameName.toUpperCase()}
          </p>
          <p className="mt-1 text-sm text-white/95 truncate">
            <span className="font-bold">{from}</span> wants to play
          </p>
          <p className="mt-0.5 text-xs text-white/50 tabular-nums">
            Expires in {left}
            {error && <span className="block text-[#ff9dbd]">{error}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => void accept(invite)} disabled={busy}
            aria-label={`Accept ${from}'s ${invite.gameName} invite`}
            className="invite-btn invite-yes">
            <Check />
          </button>
          <button onClick={() => void decline(invite)} disabled={busy}
            aria-label={`Decline ${from}'s ${invite.gameName} invite`}
            className="invite-btn invite-no">
            <Cross />
          </button>
        </div>
      </div>
    </div>
  )
}

// Hand-drawn line marks, matching icons.tsx rather than importing a tick that
// only exists inline elsewhere.
const Check = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)
const Cross = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
