// Friends hub: add friends by email, settle incoming requests, and launch or
// rejoin Battleship matches. Everything here requires sign-in; the Firestore
// helpers live in lib/social.ts.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, type NavigateFunction } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import AccountControl from '../components/AccountControl'
import VerifyEmailNotice from '../components/VerifyEmailNotice'
import {
  normalizeEmail, sendFriendRequest, hasPendingRequest, respondToRequest, removeFriend,
  sendFriendRequestToUid, hasPendingRequestToUid,
  subscribeIncomingRequests, subscribeFriendships, subscribeMyMatches,
  acceptInvite, deleteInviteMatch,
  type FriendRequest, type Friendship, type Match,
} from '../lib/social'
import { collectInvites, msLeft, formatLeft, type GameInvite } from '../lib/invites'
import { acceptGameInvite, declineGameInvite } from '../lib/inviteActions'
import { subscribeMyRooms, type LsRoom } from '../lib/lsroom'
import { subscribeMyGameRooms, gameRoomsAvailable, type GameRoom } from '../lib/gameroom'
import { seatName, validateUsername, lookupUsername } from '../lib/username'
import { INVITABLE, inviteState, type InvitableGame } from '../lib/inviteFriend'
import { displayNameFor } from '../lib/username'
import { useUsernames } from '../lib/useUsernames'
import { ArrowLeft } from '../icons'

const CY = '#3df5ff'
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}

export default function Friends() {
  const navigate = useNavigate()
  const { user, loading: authLoading, emailVerified } = useAuth()

  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-8">
          <button aria-label="Back" onClick={() => navigate('/')} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <h1 className="font-pixel text-[12px]" style={{ color: CY }}>FRIENDS</h1>
          {isFirebaseConfigured
            ? <AccountControl />
            : <span className="w-10 h-10" aria-hidden />}
        </div>

        {!isFirebaseConfigured && (
          <p className="text-center text-white/70 py-16">Friends are unavailable in this build.</p>
        )}
        {isFirebaseConfigured && authLoading && (
          <p className="text-center text-white/70 font-pixel text-[10px] py-16">CONNECTING…</p>
        )}
        {isFirebaseConfigured && !authLoading && !user && (
          <div className="text-center py-14">
            <p className="text-white/80 font-semibold mb-2">Sign in to add friends</p>
            <p className="text-sm text-white/65">Use the account button in the top-right corner, then challenge your friends to Battleship.</p>
          </div>
        )}
        {/* A signed-in but unverified email account would only hit
            permission-denied on the Firestore feeds, so we DON'T mount the
            subscriptions — we nudge them to verify first. */}
        {isFirebaseConfigured && user && user.email && !emailVerified && (
          <div className="text-center py-14">
            <p className="text-white/80 font-semibold mb-2">Verify your email to use Friends & online play</p>
            <VerifyEmailNotice
              className="flex flex-col items-center"
              message="Check your inbox for the verification link we sent, then reload this page."
            />
          </div>
        )}
        {isFirebaseConfigured && user && user.email && emailVerified && (
          <SignedIn uid={user.uid} email={user.email.toLowerCase()} />
        )}
      </div>
    </div>
  )
}

function SignedIn({ uid, email }: { uid: string; email: string }) {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<FriendRequest[] | null>(null)
  const [friends, setFriends] = useState<Friendship[] | null>(null)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [rooms, setRooms] = useState<LsRoom[]>([])
  const [gameRooms, setGameRooms] = useState<GameRoom[]>([])
  const [feedError, setFeedError] = useState('')

  useEffect(() => {
    const onError = (err: unknown) => {
      console.error('[eclipse-arcade] friends feed failed:', err)
      setFeedError('Live updates failed — check your connection and reload.')
    }
    const u1 = subscribeIncomingRequests(email, uid, setRequests, onError)
    const u2 = subscribeFriendships(uid, setFriends, onError)
    const u3 = subscribeMyMatches(uid, setMatches, onError)
    const u4 = subscribeMyRooms(uid, setRooms, onError)
    // Denied until the gameRooms rules are published — that must not take the
    // rest of the page down, so it warns and carries on with an empty list.
    const u5 = gameRoomsAvailable()
      ? subscribeMyGameRooms(uid, setGameRooms, (err) => {
        console.warn('[eclipse-arcade] shared tables unavailable (rules not published?):', err)
        setGameRooms([])
      })
      : () => {}
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [uid, email])

  // Ticks so an invite's countdown runs down and it drops off on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // EVERY game's invites, not just Battleship's. The pop-up withdraws after 20
  // seconds; this list is where an invite keeps its place for the full three
  // minutes, which is the whole point of it for someone who was mid-game.
  const incomingInvites = collectInvites(matches ?? [], rooms, gameRooms, uid, now)
  const liveMatches = (matches ?? []).filter((m) => m.status === 'placing' || m.status === 'active')

  // Reverse-lookup handles for everyone shown, so people appear by username
  // (falling back to email) — see displayNameFor.
  const usernames = useUsernames([
    ...(requests ?? []).map((r) => r.fromUid),
    ...(friends ?? []).flatMap((f) => f.uids),
    ...(matches ?? []).flatMap((m) => m.players),
    // Whoever invited me, and me — accepting writes my own name onto a seat, so
    // my handle has to resolve or it falls back to my email address.
    ...incomingInvites.map((i) => i.fromUid),
    uid,
  ])

  return (
    <div className="space-y-10">
      {feedError && <p role="alert" className="text-center text-sm text-[#ff9dbd]">{feedError}</p>}
      {(incomingInvites.length > 0 || liveMatches.length > 0) && (
        <MatchesSection uid={uid} email={email} invites={incomingInvites} live={liveMatches} usernames={usernames} navigate={navigate} now={now} />
      )}
      <AddFriend uid={uid} email={email} friends={friends ?? []} />
      <RequestsSection uid={uid} email={email} requests={requests} usernames={usernames} />
      <FriendsSection uid={uid} friends={friends} matches={matches ?? []} usernames={usernames} navigate={navigate} />
    </div>
  )
}

// ----- battleship invites + in-progress matches -----

function MatchesSection({ uid, email, invites, live, usernames, navigate, now }: {
  uid: string; email: string; invites: GameInvite[]; live: Match[]
  usernames: Record<string, string>; navigate: (to: string) => void; now: number
}) {
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function act(id: string, action: () => Promise<void>, failMsg: string) {
    setError('')
    setBusyId(id)
    try { await action() } catch (err) {
      console.error('[eclipse-arcade] invite action failed:', err)
      setError(failMsg)
      setBusyId(null)
      return
    }
    setBusyId(null)
  }

  return (
    <Section title="GAMES">
      {error && <ErrorLine text={error} />}
      <ul className="grid gap-3">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-neon-magenta/40 bg-neon-magenta/10 p-4">
            <span className="min-w-0 text-sm text-white/90">
              <span className="block truncate">
                <span className="font-semibold">{displayNameFor(usernames[i.fromUid], null)}</span> invited you to {i.gameName}
              </span>
              <span className="block text-xs text-white/50 tabular-nums mt-0.5">
                Expires in {formatLeft(msLeft(i, now))}
              </span>
            </span>
            <span className="flex gap-2 shrink-0">
              <button
                onClick={() => void act(i.id, async () => {
                  const route = await acceptGameInvite(i, { uid, name: seatName(usernames[uid], email) })
                  navigate(route)
                }, 'Could not accept the invite — try again.')}
                disabled={busyId !== null}
                className="arcade-btn font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                ACCEPT
              </button>
              <button
                onClick={() => void act(i.id, () => declineGameInvite(i, uid), 'Could not decline the invite — try again.')}
                disabled={busyId !== null}
                className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-60">
                DECLINE
              </button>
            </span>
          </li>
        ))}
        {live.map((m) => {
          const opp = m.players[0] === uid ? m.players[1] : m.players[0]
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <span className="text-sm text-white/90 truncate">
                Battle vs <span className="font-semibold">{displayNameFor(usernames[opp], m.emails[opp])}</span>
                <span className="ml-2 font-pixel text-[8px] text-neon-green">{m.status === 'active' ? 'LIVE' : 'PLACING'}</span>
              </span>
              <Link to={`/battleship/pvp/${m.id}`} className="arcade-btn shrink-0 font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620]" style={CY_BTN}>
                REJOIN
              </Link>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ----- add friend -----

function AddFriend({ uid, email, friends }: { uid: string; email: string; friends: Friendship[] }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSentTo('')
    const typed = value.trim()
    if (!typed) { setError('Enter a username or an email address.'); return }
    // An "@" is the only reliable tell: usernames can't contain one (see
    // validateUsername), so anything with one is meant as an address.
    const looksLikeEmail = typed.includes('@')

    if (looksLikeEmail) {
      const to = normalizeEmail(typed)
      if (!to) { setError('That email address does not look right.'); return }
      if (to === email) { setError('That would be you — invite someone else.'); return }
      if (friends.some((f) => f.emails.includes(to))) { setError('You are already friends.'); return }
      setBusy(true)
      try {
        if (await hasPendingRequest(uid, to)) { setError('Request already sent — waiting for them to accept.'); return }
        await sendFriendRequest(uid, email, to)
        setSentTo(to)
        setValue('')
      } catch (err) {
        console.error('[eclipse-arcade] friend request failed:', err)
        setError('Could not send the request — check your connection and try again.')
      } finally { setBusy(false) }
      return
    }

    const check = validateUsername(typed)
    if (!check.ok) { setError(check.reason); return }
    setBusy(true)
    try {
      const toUid = await lookupUsername(typed)
      // Deliberately the same wording whether the handle is free or taken by
      // somebody who isn't you — this form should not double as a way to test
      // whether a given handle exists.
      if (!toUid) { setError(`Nobody here goes by ${check.value}.`); return }
      if (toUid === uid) { setError('That would be you — invite someone else.'); return }
      if (friends.some((f) => f.uids.includes(toUid))) { setError('You are already friends.'); return }
      if (await hasPendingRequestToUid(uid, toUid)) { setError('Request already sent — waiting for them to accept.'); return }
      await sendFriendRequestToUid(uid, email, toUid)
      setSentTo(check.value)
      setValue('')
    } catch (err) {
      console.error('[eclipse-arcade] friend request failed:', err)
      setError('Could not send the request — check your connection and try again.')
    } finally { setBusy(false) }
  }

  return (
    <Section title="ADD A FRIEND">
      <form onSubmit={(e) => void submit(e)} className="flex gap-2.5">
        <label htmlFor="friend-who" className="sr-only">Friend's username or email address</label>
        <input
          id="friend-who"
          // Not type="email": this field takes a username too, and the browser
          // would refuse to submit one.
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); setSentTo('') }}
          placeholder="username or friend@example.com"
          className="flex-1 min-w-0 rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white placeholder:text-white/40"
        />
        <button type="submit" disabled={busy}
          className="arcade-btn shrink-0 font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
          {busy ? 'SENDING…' : 'SEND REQUEST'}
        </button>
      </form>
      {error && <p role="alert" className="mt-2.5 text-sm text-[#ff9dbd]">{error}</p>}
      {sentTo && <p role="status" className="mt-2.5 text-sm text-neon-green">Request sent to {sentTo} — they'll see it here when they sign in.</p>}
    </Section>
  )
}

// ----- incoming requests -----

function RequestsSection({ uid, email, requests, usernames }: {
  uid: string; email: string; requests: FriendRequest[] | null; usernames: Record<string, string>
}) {
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function respond(req: FriendRequest, accept: boolean) {
    setError('')
    setBusyId(req.id)
    try { await respondToRequest(req, accept, uid, email) } catch (err) {
      console.error('[eclipse-arcade] request response failed:', err)
      setError('Could not update the request — try again.')
    } finally { setBusyId(null) }
  }

  return (
    <Section title="REQUESTS">
      {error && <ErrorLine text={error} />}
      {requests === null && <Muted>Loading requests…</Muted>}
      {requests !== null && requests.length === 0 && <Muted>No pending requests. Friend requests sent to your email show up here.</Muted>}
      {requests !== null && requests.length > 0 && (
        <ul className="grid gap-3">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <span className="text-sm text-white/90 truncate">{displayNameFor(usernames[r.fromUid], r.fromEmail)}</span>
              <span className="flex gap-2 shrink-0">
                <button onClick={() => void respond(r, true)} disabled={busyId !== null}
                  className="arcade-btn font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                  ACCEPT
                </button>
                <button onClick={() => void respond(r, false)} disabled={busyId !== null}
                  className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-60">
                  DECLINE
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ----- friends list -----

function FriendsSection({ uid, friends, matches, usernames, navigate }: {
  uid: string; friends: Friendship[] | null; matches: Match[]
  usernames: Record<string, string>; navigate: NavigateFunction
}) {
  const [error, setError] = useState('')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [confirmUnfriendId, setConfirmUnfriendId] = useState<string | null>(null)
  // Which friend's game picker is open, if any.
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  function invite(game: InvitableGame, friendUid: string, friendEmail: string) {
    setPickingFor(null)
    // A Battleship invite to this friend already pending? Jump back into it
    // rather than stacking a duplicate challenge.
    if (game.key === 'battleship') {
      const existing = matches.find((m) => m.status === 'invite' && m.players[0] === uid && m.players[1] === friendUid)
      if (existing) { navigate(`/battleship/pvp/${existing.id}`); return }
    }
    // Every game needs a topic, and this page has no topic picker — so hand the
    // friend to the game's own setup screen, which finishes the job.
    navigate(game.route, { state: inviteState({ uid: friendUid, email: friendEmail }) })
  }

  async function unfriend(f: Friendship, friendUid: string) {
    setError('')
    setConfirmUnfriendId(null)
    setBusyUid(friendUid)
    try { await removeFriend(f) } catch (err) {
      console.error('[eclipse-arcade] unfriend failed:', err)
      setError('Could not remove this friend — try again.')
    } finally { setBusyUid(null) }
  }

  return (
    <Section title="YOUR FRIENDS">
      {error && <ErrorLine text={error} />}
      {friends === null && <Muted>Loading friends…</Muted>}
      {friends !== null && friends.length === 0 && <Muted>No friends yet — send a request above to get a rivalry going.</Muted>}
      {friends !== null && friends.length > 0 && (
        <ul className="grid gap-3">
          {friends.map((f) => {
            const idx = f.uids[0] === uid ? 1 : 0
            const name = displayNameFor(usernames[f.uids[idx]], f.emails[idx])
            return (
              <li key={f.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white/90 truncate">{name}</span>
                  {confirmUnfriendId === f.id ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-sm text-white/80">Remove {name}?</span>
                      <button onClick={() => void unfriend(f, f.uids[idx])} disabled={busyUid !== null}
                        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-[#ff4d8d] text-[#2a0512] disabled:opacity-60">
                        CONFIRM
                      </button>
                      <button onClick={() => setConfirmUnfriendId(null)} disabled={busyUid !== null}
                        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-60">
                        KEEP
                      </button>
                    </span>
                  ) : (
                    <span className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setPickingFor(pickingFor === f.id ? null : f.id)}
                        disabled={busyUid !== null}
                        aria-expanded={pickingFor === f.id}
                        className="arcade-btn font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                        {pickingFor === f.id ? 'CLOSE' : 'INVITE TO A GAME'}
                      </button>
                      <button onClick={() => setConfirmUnfriendId(f.id)} disabled={busyUid !== null}
                        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-60">
                        UNFRIEND
                      </button>
                    </span>
                  )}
                </div>

                {pickingFor === f.id && confirmUnfriendId !== f.id && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="font-pixel text-[9px] text-white/50 mb-2">PICK A GAME</p>
                    <ul className="grid gap-2">
                      {INVITABLE.map((g) => (
                        <li key={g.key}>
                          <button
                            onClick={() => invite(g, f.uids[idx], f.emails[idx])}
                            className="w-full text-left rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.07] transition">
                            <span className="block font-sans font-semibold text-sm" style={{ color: g.color }}>
                              {g.name}
                            </span>
                            <span className="block text-xs text-white/55 mt-0.5">{g.blurb}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-white/45">
                      You'll pick the topic on the next screen, then they get the invite.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

// ----- shared bits -----

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-pixel text-[10px] tracking-wider text-neon-cyan neon-text mb-4">{title}</h2>
      {children}
    </section>
  )
}
function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-white/65">{children}</p>
}
function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="text-sm text-[#ff9dbd] mb-3">{text}</p>
}
