// Last Standing with friends. The protocol and trust model live in
// lib/lsroom.ts; this page is the client for it.
//
// Every seated client replays the SAME pure reducer (lib/laststanding.ts) over
// the state carried in the room doc, so there is no separate online rule set to
// keep in step with the solo game. A client only ever commits a transition it
// owns: your own answer, your own banish pick, your own timeout. The host
// additionally acts as caretaker — running AI seats, picking an AI winner's
// banish, and timing out a player who has gone quiet — so one silent tab can't
// freeze the table.
//
// Accessibility: the 3D table is decorative; turn state, the countdown and
// every outcome are announced in the DOM (aria-live) and every control is a
// real labelled button.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Course, Question, Subunit } from '../data/subjects'
import { loadCourse } from '../lib/content'
import { usePlayer, levelFromXp } from '../lib/player'
import { useAuth } from '../lib/auth'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor, seatNameFor } from '../lib/username'
import { isFirebaseConfigured } from '../lib/firebase'
import { subscribeFriendships, wasRewarded, markRewarded, type Friendship } from '../lib/social'
import {
  MAX_SEATS, buildRoomSeats, seatOfUid, isHost, isMyTurn, isMyBanish,
  questionIndexFor, secondsLeftFor, hostShouldResolveTurn, hostShouldBanish, placementOf,
  subscribeRoom, joinRoom, leaveRoom, startRoom, inviteToRoom, commitTransition, deleteRoom,
  type LsRoom,
} from '../lib/lsroom'
import {
  SEAT_COUNT, applyAnswer, banish, timeForTurn, isAlive, lobbySeats,
  aiRateFor, aiAnswerChance, aiSolves, aiBanishTarget, scoreForPlacement,
} from '../lib/laststanding'
import LastStandingTable3D from '../components/LastStandingTable3D'
import QuestionPanel from '../components/QuestionPanel'
import { isReducedMotion } from '../lib/motion'
import { ArrowLeft, Crown, Coin, Bolt, Star, Users } from '../icons'
import { sfxPick, sfxDeny, sfxWin } from '../lib/sound'

const ACCENT = '#ff4d8d'
const AI_THINK_MS = 1400 // the beat before the host resolves an AI seat
const TICK_MS = 250 // countdown / caretaker cadence

// If the host's topic was emptied since the room opened, players still need
// SOMETHING to answer rather than a dead table (mirrors BattleshipPvp).
const FALLBACK_QUESTION: Question = {
  prompt: 'This topic has no questions right now — type "ready" to take your turn.',
  fill: 'ready',
}

function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export default function LastStandingOnline() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const { user, emailVerified } = useAuth()
  const { player, finishGame } = usePlayer()
  const uid = user?.uid ?? ''

  const [room, setRoom] = useState<LsRoom | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [course, setCourse] = useState<Course | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ placement: number; score: number; rewards: ReturnType<typeof finishGame> } | null>(null)

  // When this client first saw the current tick — carries the countdown while
  // the server timestamp is still in flight.
  const seenTick = useRef<{ tick: number; at: number }>({ tick: -1, at: Date.now() })
  // One commit per tick from this client, so a re-render can't double-resolve.
  const committed = useRef<number>(-1)
  const aiReadyAt = useRef<number>(0)

  useEffect(() => {
    if (!roomId || !isFirebaseConfigured) { setLoaded(true); return }
    return subscribeRoom(roomId, (r) => { setRoom(r); setLoaded(true) }, (err) => {
      setError(err instanceof Error ? err.message : 'Could not open that room.')
      setLoaded(true)
    })
  }, [roomId])

  // A steady local clock drives both the countdown and the host's caretaker check.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (room && room.tick !== seenTick.current.tick) {
      seenTick.current = { tick: room.tick, at: Date.now() }
      aiReadyAt.current = Date.now() + AI_THINK_MS
    }
  }, [room])

  useEffect(() => {
    let cancelled = false
    if (!room) return
    loadCourse(room.sel.courseId).then((c) => { if (!cancelled) setCourse(c) }).catch(() => {
      if (!cancelled) setCourse(null)
    })
    return () => { cancelled = true }
  }, [room?.sel.courseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const subunit: Subunit | null = useMemo(() => {
    if (!course || !room) return null
    const unit = course.units.find((u) => u.id === room.sel.unitId)
    return unit?.subunits.find((s) => s.id === room.sel.subunitId) ?? null
  }, [course, room])

  const pool = subunit?.questions ?? []
  const question: Question = pool.length > 0
    ? pool[questionIndexFor(room?.seed ?? 0, room?.tick ?? 0, pool.length)]
    : FALLBACK_QUESTION

  // Handles for everyone at the table. Seat names are baked into the room doc
  // when a player joins, so rooms opened before handles were stored still carry
  // an email — remapping here fixes those live rather than migrating the doc.
  const handles = useUsernames(room ? [...room.members, ...room.invited] : [])
  const myName = seatNameFor(handles[uid], user?.email)
  const displayState = useMemo(() => {
    if (!room) return null
    const seats = room.state.seats.map((s, i) => {
      const owner = room.seatUids[i]
      return owner ? { ...s, name: seatNameFor(handles[owner], room.names[owner]) } : s
    })
    return { ...room.state, seats }
  }, [room, handles])

  const mySeat = room ? seatOfUid(room, uid) : -1
  const secondsLeft = room && room.status === 'active' && room.state.phase.kind === 'turn'
    ? secondsLeftFor(room, now, seenTick.current.at)
    : null

  /** Commit a transition computed from the tick we are looking at. */
  const commit = useCallback(async (next: Parameters<typeof commitTransition>[2], tick: number) => {
    if (committed.current === tick) return
    committed.current = tick
    try {
      await commitTransition(roomId, tick, next)
    } catch (err) {
      committed.current = -1
      setError(err instanceof Error ? err.message : 'That move did not go through.')
    }
  }, [roomId])

  // ---- my own turn: answering, and running my own clock out ----------------
  const answer = useCallback((correct: boolean) => {
    if (!room || !isMyTurn(room, uid)) return
    if (correct) sfxPick(); else sfxDeny()
    void commit(applyAnswer(room.state, correct), room.tick)
  }, [room, uid, commit])

  useEffect(() => {
    if (!room || !isMyTurn(room, uid)) return
    if (secondsLeft !== null && secondsLeft <= 0) void commit(applyAnswer(room.state, false), room.tick)
  }, [room, uid, secondsLeft, commit])

  // ---- host caretaker: AI seats, silent players, AI banish -----------------
  useEffect(() => {
    if (!room || !uid || !isHost(room, uid)) return
    if (room.status !== 'active') return
    if (hostShouldBanish(room, uid)) {
      const winner = room.state.phase.kind === 'banish' ? room.state.phase.winner : -1
      const target = aiBanishTarget(room.state, winner)
      if (target >= 0) void commit(banish(room.state, target), room.tick)
      return
    }
    if (!hostShouldResolveTurn(room, now, seenTick.current.at)) return
    const seat = room.state.seats[room.state.turn]
    const isAiSeat = room.seatUids[room.state.turn] === null
    if (isAiSeat) {
      if (now < aiReadyAt.current) return // let the AI "read" the question first
      const aiIndex = room.state.seats.slice(0, room.state.turn).filter((s) => s.kind === 'ai').length
      const chance = aiAnswerChance(aiRateFor(aiIndex, room.sel.difficulty), timeForTurn(seat.turnsTaken))
      void commit(applyAnswer(room.state, aiSolves(Math.random, chance)), room.tick)
    } else {
      void commit(applyAnswer(room.state, false), room.tick) // gone quiet — time them out
    }
  }, [room, uid, now, commit])

  // ---- rewards, once, when the table has a champion ------------------------
  useEffect(() => {
    if (!room || room.state.phase.kind !== 'champion' || mySeat < 0) return
    if (result || wasRewarded(room.id)) return
    markRewarded(room.id)
    const placement = placementOf(room.state, mySeat)
    const score = scoreForPlacement(placement, SEAT_COUNT)
    if (placement === 1) sfxWin()
    setResult({ placement, score, rewards: finishGame('laststanding', score) })
  }, [room, mySeat, result, finishGame])

  // ---- guards --------------------------------------------------------------
  if (!isFirebaseConfigured) return <Shell onBack={() => navigate('/laststanding')}><Notice>Online play needs the arcade's accounts backend, which isn't configured in this build.</Notice></Shell>
  if (!user) return <Shell onBack={() => navigate('/laststanding')}><Notice>Sign in from the lobby to play Last Standing with friends.</Notice></Shell>
  if (!emailVerified) return <Shell onBack={() => navigate('/laststanding')}><Notice>Verify your email address before joining an online table.</Notice></Shell>
  if (!loaded) return <Shell onBack={() => navigate('/laststanding')}><Notice>Opening the table…</Notice></Shell>
  if (!room) return <Shell onBack={() => navigate('/laststanding')}><Notice>{error || 'That table has closed.'}</Notice></Shell>

  const iAmHost = isHost(room, uid)
  const iAmSeated = mySeat >= 0
  const invitedMe = room.invited.includes(uid)

  return (
    <Shell onBack={() => navigate('/laststanding')}>
      {error && <p role="alert" className="mb-4 text-center text-sm text-[#ff9dbd]">{error}</p>}

      {room.status === 'lobby' && (
        <Lobby
          room={room} uid={uid} myName={myName} iAmHost={iAmHost} iAmSeated={iAmSeated}
          invitedMe={invitedMe} busy={busy} setBusy={setBusy} setError={setError}
          onLeft={() => navigate('/laststanding')}
        />
      )}

      {room.status !== 'lobby' && (
        <Table
          room={room} uid={uid} mySeat={mySeat} question={question} secondsLeft={secondsLeft}
          state={displayState ?? room.state}
          onAnswer={answer}
          onBanish={(target) => void commit(banish(room.state, target), room.tick)}
        />
      )}

      {room.state.phase.kind === 'champion' && (
        <Champion
          room={room} state={displayState ?? room.state} mySeat={mySeat} result={result} level={levelFromXp(player.xp).level}
          iAmHost={iAmHost}
          onClose={async () => { if (iAmHost) await deleteRoom(room.id); navigate('/laststanding') }}
        />
      )}
    </Shell>
  )
}

// ---- lobby -----------------------------------------------------------------

function Lobby({ room, uid, myName, iAmHost, iAmSeated, invitedMe, busy, setBusy, setError, onLeft }: {
  room: LsRoom; uid: string; myName: string; iAmHost: boolean; iAmSeated: boolean
  invitedMe: boolean; busy: boolean
  setBusy: (b: boolean) => void; setError: (m: string) => void; onLeft: () => void
}) {
  const [friends, setFriends] = useState<Friendship[]>([])
  useEffect(() => {
    if (!iAmHost || !uid) return
    return subscribeFriendships(uid, setFriends, () => setFriends([]))
  }, [iAmHost, uid])

  const friendUids = friends.map((f) => (f.uids[0] === uid ? f.uids[1] : f.uids[0]))
  const friendEmail = (fid: string) => {
    const f = friends.find((x) => x.uids.includes(fid))
    return f ? f.emails[f.uids.indexOf(fid)] : ''
  }
  const names = useUsernames([...room.members, ...room.invited, ...friendUids])
  // Handle if they have one, else just the local part — never the whole address
  // on a screen other players are looking at.
  const nameOf = (u: string) =>
    displayNameFor(names[u], (room.names[u] ?? friendEmail(u)).split('@')[0])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  const seated = room.members.length
  const canStart = iAmHost && seated >= 2

  return (
    <div className="grid gap-6">
      <Section title="THE TABLE">
        <p className="text-center text-sm text-white/60 mb-4">
          {seated} of {MAX_SEATS} seats taken by players — the rest are filled by the house.
        </p>
        <ol className="grid gap-2">
          {buildRoomSeats(room.members.map((u) => ({ uid: u, name: nameOf(u) }))).state.seats.map((s, i) => {
            const u = room.members[i]
            return (
              <li key={s.seat} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="flex items-center gap-3">
                  <span aria-hidden className="grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold"
                    style={{ background: u ? `${ACCENT}33` : 'rgba(255,255,255,0.06)', color: u ? '#ff9dbd' : 'rgba(255,255,255,0.5)' }}>
                    {s.seat + 1}
                  </span>
                  <span className="font-semibold">{s.name}</span>
                </span>
                <span className="font-sans text-xs font-semibold tracking-wide" style={{ color: u ? '#ff9dbd' : 'rgba(255,255,255,0.45)' }}>
                  {u === room.host ? 'HOST' : u ? 'PLAYER' : 'HOUSE AI'}
                </span>
              </li>
            )
          })}
        </ol>
      </Section>

      {room.invited.length > 0 && (
        <Section title="INVITED">
          <ul className="grid gap-2">
            {room.invited.map((u) => (
              <li key={u} className="flex items-center justify-between rounded-lg border border-white/10 px-4 py-2.5 text-sm">
                <span className="text-white/80">{nameOf(u)}</span>
                <span className="text-white/50 font-sans text-xs">waiting…</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {iAmHost && (
        <Section title="INVITE FRIENDS">
          {friendUids.length === 0 ? (
            <p className="text-center text-sm text-white/60">Add friends from the Friends page to invite them here.</p>
          ) : (
            <ul className="grid gap-2">
              {friendUids.map((f) => {
                const already = room.members.includes(f) || room.invited.includes(f)
                const full = room.members.length + room.invited.length >= MAX_SEATS
                return (
                  <li key={f} className="flex items-center justify-between rounded-lg border border-white/10 px-4 py-2.5">
                    <span className="text-sm font-semibold truncate">{nameOf(f)}</span>
                    <button
                      onClick={() => void run(() => inviteToRoom(room.id, f))}
                      disabled={already || full || busy}
                      className="font-sans text-xs font-bold px-3 py-1.5 rounded text-white disabled:opacity-40"
                      style={{ background: already ? 'rgba(255,255,255,0.12)' : ACCENT }}
                    >
                      {already ? 'Invited' : full ? 'Table full' : 'Invite'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {!iAmSeated && invitedMe && (
          <button onClick={() => void run(() => joinRoom(room.id, { uid, name: myName }))} disabled={busy}
            className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white disabled:opacity-50" style={{ background: ACCENT }}>
            Take a seat
          </button>
        )}
        {canStart && (
          <button onClick={() => void run(() => startRoom(room.id, uid))} disabled={busy}
            className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white disabled:opacity-50" style={{ background: ACCENT }}>
            Start the game
          </button>
        )}
        {iAmHost && !canStart && (
          <span className="self-center text-xs text-white/60">Invite at least one friend to start.</span>
        )}
        <button onClick={() => void run(async () => { await leaveRoom(room.id, uid); onLeft() })} disabled={busy}
          className="font-sans font-semibold text-sm px-5 py-3 rounded-lg bg-white/5 border border-white/15 text-white/85 hover:bg-white/10 disabled:opacity-50">
          {iAmHost ? 'Close the table' : 'Leave'}
        </button>
      </div>
    </div>
  )
}

// ---- the live table ---------------------------------------------------------

function Table({ room, uid, mySeat, question, secondsLeft, state, onAnswer, onBanish }: {
  room: LsRoom; uid: string; mySeat: number; question: Question; secondsLeft: number | null
  state: LsRoom['state'] // room.state with seat names remapped to handles
  onAnswer: (correct: boolean) => void
  onBanish: (target: number) => void
}) {
  const myTurn = isMyTurn(room, uid)
  const myBanish = isMyBanish(room, uid)
  const onTurnName = state.seats[state.turn]?.name ?? ''
  const alive = mySeat >= 0 && isAlive(state.seats[mySeat])

  const status = state.phase.kind === 'champion'
    ? `${state.seats[state.phase.champion].name} is the last one standing.`
    : state.phase.kind === 'banish'
      ? `${state.seats[state.phase.winner].name} won the round and is choosing who to banish.`
      : myTurn ? `Your turn — ${secondsLeft ?? 0} seconds left.`
        : `${onTurnName} is answering.`

  return (
    <div>
      <LastStandingTable3D state={state} accent={ACCENT} reduced={prefersReducedMotion()} secondsLeft={secondsLeft} />

      <div className="mt-3 flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/10 px-4 py-2.5">
        <span className="font-sans text-xs font-bold tracking-[0.14em] text-white/80">ROUND {state.round}</span>
        {state.phase.kind === 'turn' && secondsLeft !== null && (
          <span role="timer" aria-label={`${secondsLeft} seconds left`} className="font-sans text-sm font-bold tabular-nums"
            style={{ color: secondsLeft <= 5 ? '#ff9dbd' : 'rgba(255,255,255,0.9)' }}>
            {myTurn ? 'YOUR CLOCK' : `${onTurnName}'S CLOCK`} · {secondsLeft}s
          </span>
        )}
      </div>

      <div className="mt-4">
        {myTurn && (
          <QuestionPanel q={question} color={ACCENT} onSubmit={onAnswer} surface="plain"
            label="ANSWER BEFORE THE CLOCK RUNS OUT" />
        )}
        {!myTurn && state.phase.kind === 'turn' && (
          <p className="text-center text-sm text-white/60 py-3">
            {alive ? `${onTurnName} is answering…` : `You're out this round — ${onTurnName} is answering…`}
          </p>
        )}
        {myBanish && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-center font-sans font-bold text-sm tracking-wide mb-1" style={{ color: '#ff9dbd' }}>YOU WIN THE ROUND</p>
            <p className="text-center text-sm text-white/70 mb-4">Banish one player from the table — for good.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {lobbySeats(state).filter((s) => s.seat !== mySeat).map((s) => (
                <button key={s.seat} onClick={() => onBanish(s.seat)}
                  className="font-sans font-bold text-sm px-4 py-3 rounded-lg text-white border border-white/15 bg-white/5 hover:bg-white/10"
                  style={{ boxShadow: `inset 3px 0 0 ${ACCENT}` }}>
                  Banish {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.phase.kind === 'banish' && !myBanish && (
          <p className="text-center text-sm text-white/60 py-3">
            {state.seats[state.phase.winner].name} won the round and is choosing who to banish…
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">{status}</p>
    </div>
  )
}

// ---- game over --------------------------------------------------------------

function Champion({ room, state, mySeat, result, level, iAmHost, onClose }: {
  room: LsRoom; state: LsRoom['state']; mySeat: number
  result: { placement: number; score: number; rewards: { coins: number; xp: number; best?: boolean } } | null
  level: number; iAmHost: boolean; onClose: () => void
}) {
  const phase = state.phase
  const champion = phase.kind === 'champion' ? state.seats[phase.champion] : null
  const iWon = phase.kind === 'champion' && phase.champion === mySeat

  return (
    <div className="text-center py-8">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: iWon ? '#3dffa2' : '#ff9dbd' }}>
        {iWon ? 'Last one standing!' : `${champion?.name ?? 'Nobody'} takes the table`}
      </div>
      {result && (
        <>
          <div className="flex justify-center gap-3 my-4">
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold"><Coin width={18} height={18} /> +{result.rewards.coins}</span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#ff9dbd' }}><Bolt width={18} height={18} /> +{result.rewards.xp} XP</span>
          </div>
          {result.rewards.best && <div className="inline-flex items-center gap-1 font-sans font-bold text-[11px] tracking-wide px-2.5 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2"><Star width={12} height={12} /> NEW BEST</div>}
          <div className="text-xs text-white/50 mb-6">Level {level}</div>
        </>
      )}
      <button onClick={onClose} className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white" style={{ background: ACCENT }}>
        {iAmHost ? 'Close the table' : 'Back to Last Standing'}
      </button>
    </div>
  )
}

// ---- chrome -----------------------------------------------------------------

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={onBack} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="flex items-center gap-2 font-sans font-bold text-sm tracking-[0.14em]" style={{ color: '#ff9dbd' }}>
            <Crown width={18} height={18} /> LAST STANDING
          </div>
          <span aria-hidden className="grid place-items-center w-10 h-10 text-white/40"><Users width={18} height={18} /></span>
        </div>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-sans font-bold text-sm tracking-[0.18em] mb-4 text-center" style={{ color: '#ff9dbd' }}>{title}</h2>{children}</div>
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-sm text-white/70 py-16">{children}</p>
}
