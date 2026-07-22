// Friends hub: add friends by email, settle incoming requests, and launch or
// rejoin Battleship matches. Everything here requires sign-in; the Firestore
// helpers live in lib/social.ts.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import AccountControl from '../components/AccountControl'
import { COURSES } from '../data/subjects'
import {
  normalizeEmail, sendFriendRequest, hasPendingRequest, respondToRequest,
  subscribeIncomingRequests, subscribeFriendships, subscribeMyMatches,
  createInviteMatch, acceptInvite, deleteInviteMatch,
  type FriendRequest, type Friendship, type Match,
} from '../lib/social'
import { ArrowLeft } from '../icons'

const CY = '#3df5ff'
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}

export default function Friends() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

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
        {isFirebaseConfigured && user && user.email && (
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
  const [feedError, setFeedError] = useState('')

  useEffect(() => {
    const onError = (err: unknown) => {
      console.error('[eclipse-arcade] friends feed failed:', err)
      setFeedError('Live updates failed — check your connection and reload.')
    }
    const u1 = subscribeIncomingRequests(email, setRequests, onError)
    const u2 = subscribeFriendships(uid, setFriends, onError)
    const u3 = subscribeMyMatches(uid, setMatches, onError)
    return () => { u1(); u2(); u3() }
  }, [uid, email])

  const incomingInvites = (matches ?? []).filter((m) => m.status === 'invite' && m.players[0] !== uid)
  const liveMatches = (matches ?? []).filter((m) => m.status === 'placing' || m.status === 'active')

  return (
    <div className="space-y-10">
      {feedError && <p role="alert" className="text-center text-sm text-[#ff9dbd]">{feedError}</p>}
      {(incomingInvites.length > 0 || liveMatches.length > 0) && (
        <MatchesSection uid={uid} invites={incomingInvites} live={liveMatches} navigate={navigate} />
      )}
      <AddFriend uid={uid} email={email} friends={friends ?? []} />
      <RequestsSection uid={uid} requests={requests} />
      <FriendsSection uid={uid} email={email} friends={friends} matches={matches ?? []} navigate={navigate} />
    </div>
  )
}

// ----- battleship invites + in-progress matches -----

function MatchesSection({ uid, invites, live, navigate }: {
  uid: string; invites: Match[]; live: Match[]; navigate: (to: string) => void
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
    <Section title="BATTLES">
      {error && <ErrorLine text={error} />}
      <ul className="grid gap-3">
        {invites.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-neon-magenta/40 bg-neon-magenta/10 p-4">
            <span className="text-sm text-white/90 truncate">
              <span className="font-semibold">{m.emails[m.players[0]] ?? 'A player'}</span> challenges you to Battleship
            </span>
            <span className="flex gap-2 shrink-0">
              <button
                onClick={() => void act(m.id, async () => { await acceptInvite(m.id); navigate(`/battleship/pvp/${m.id}`) }, 'Could not accept the invite — try again.')}
                disabled={busyId !== null}
                className="arcade-btn font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                ACCEPT
              </button>
              <button
                onClick={() => void act(m.id, () => deleteInviteMatch(m.id), 'Could not decline the invite — try again.')}
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
                Battle vs <span className="font-semibold">{m.emails[opp] ?? 'a player'}</span>
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
    const to = normalizeEmail(value)
    if (!to) { setError('Enter a valid email address.'); return }
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
  }

  return (
    <Section title="ADD A FRIEND">
      <form onSubmit={(e) => void submit(e)} className="flex gap-2.5">
        <label htmlFor="friend-email" className="sr-only">Friend's email address</label>
        <input
          id="friend-email"
          type="email"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); setSentTo('') }}
          placeholder="friend@example.com"
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

function RequestsSection({ uid, requests }: { uid: string; requests: FriendRequest[] | null }) {
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function respond(req: FriendRequest, accept: boolean) {
    setError('')
    setBusyId(req.id)
    try { await respondToRequest(req, accept, uid) } catch (err) {
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
              <span className="text-sm text-white/90 truncate">{r.fromEmail}</span>
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

function FriendsSection({ uid, email, friends, matches, navigate }: {
  uid: string; email: string; friends: Friendship[] | null; matches: Match[]; navigate: (to: string) => void
}) {
  const [error, setError] = useState('')
  const [busyUid, setBusyUid] = useState<string | null>(null)

  async function invite(friendUid: string, friendEmail: string) {
    // An invite to this friend already pending? Jump back into it instead of
    // stacking a duplicate challenge.
    const existing = matches.find((m) => m.status === 'invite' && m.players[0] === uid && m.players[1] === friendUid)
    if (existing) { navigate(`/battleship/pvp/${existing.id}`); return }
    setError('')
    setBusyUid(friendUid)
    try {
      const id = await createInviteMatch({ uid, email }, { uid: friendUid, email: friendEmail }, COURSES[0].id)
      navigate(`/battleship/pvp/${id}`)
    } catch (err) {
      console.error('[eclipse-arcade] battleship invite failed:', err)
      setError('Could not create the invite — try again.')
      setBusyUid(null)
    }
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
            return (
              <li key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <span className="text-sm text-white/90 truncate">{f.emails[idx]}</span>
                <button onClick={() => void invite(f.uids[idx], f.emails[idx])} disabled={busyUid !== null}
                  className="arcade-btn shrink-0 font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                  {busyUid === f.uids[idx] ? 'INVITING…' : 'INVITE TO BATTLESHIP'}
                </button>
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
