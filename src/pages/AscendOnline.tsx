// Ascend, played with friends around one board.
//
// Every seated client replays the SAME pure reducer (lib/ascendRoom.ts) over the
// state carried in the room document, so there is no separate online rule set to
// keep in step with the solo climb. A client only ever commits the turn it owns,
// and `tick` must advance by exactly one, so a stale tab's write is dropped
// rather than replaying somebody's roll.
//
// The question everyone answers is derived from the room's seed and tick, so all
// four screens show the same one without anybody having to publish it.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { usePlayer, levelFromXp } from '../lib/player'
import { loadCourse } from '../lib/content'
import { isFirebaseConfigured } from '../lib/firebase'
import type { Course, Question, Subunit } from '../data/subjects'
import {
  subscribeGameRoom, inviteToGameRoom, joinGameRoom, leaveGameRoom, startGameRoom,
  commitGameTransition, deleteGameRoom, type GameRoom,
} from '../lib/gameroom'
import {
  toAscendState, ascendStateData, applyAscendAnswer, createAscendState, rollForTurn,
  ascendPlacements, ascendScoreFor, isOver, MAX_SEATS, type AscendState,
} from '../lib/ascendRoom'
import { resolveMove, LAST_SQUARE } from '../lib/ascend'
import { questionIndexFor } from '../lib/lsroom'
import { subscribeFriendships, type Friendship } from '../lib/social'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor, seatName } from '../lib/username'
import AscendBoard3D, { type BoardMove } from '../components/AscendBoard3D'
import TableLobby from '../components/TableLobby'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, type AnsweredItem } from '../lib/summary'
import { isReducedMotion } from '../lib/motion'
import { sfxPick, sfxDeny, sfxWin } from '../lib/sound'
import { ArrowLeft, Coin, Bolt, Star, Replay } from '../icons'

const ACCENT = '#3dffa2'
const BTN: CSSProperties = { background: ACCENT, color: '#04331d' }

export default function AscendOnline() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, emailVerified } = useAuth()
  const { player, finishGame, recordAnswer } = usePlayer()
  const uid = user?.uid ?? null

  const [room, setRoom] = useState<GameRoom | null>(null)
  const [missing, setMissing] = useState(false)
  const [course, setCourse] = useState<Course | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reward, setReward] = useState<{ xp: number; coins: number; best: boolean } | null>(null)
  const answersRef = useRef<AnsweredItem[]>([])
  const rewardedRef = useRef(false)
  const [boardMove, setBoardMove] = useState<BoardMove | null>(null)
  const seenTickRef = useRef(-1)

  // ---- the room feed ------------------------------------------------------
  useEffect(() => {
    if (!roomId || !uid || !isFirebaseConfigured) return
    return subscribeGameRoom(roomId, (r) => {
      if (!r) { setMissing(true); return }
      setRoom(r)
    }, (err) => {
      console.error('[eclipse-arcade] table feed failed:', err)
      setError('Lost contact with the table — check your connection and reload.')
    })
  }, [roomId, uid])

  // The host's topic pick is what everyone answers.
  useEffect(() => {
    const courseId = room?.sel.courseId
    if (!courseId) return
    let cancelled = false
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [room?.sel.courseId])

  const state: AscendState | null = useMemo(
    () => (room ? toAscendState(room.state) : null), [room],
  )
  // Seats, not membership. Leaving mid-race shrinks `members` but deliberately
  // leaves `seatUids` and the board alone, so indexing by members would slide
  // everyone behind the leaver onto somebody else's piece.
  const seats = room?.seatUids ?? []
  const mySeat = room && uid ? seats.indexOf(uid) : -1
  const seated = mySeat >= 0
  const myTurn = !!state && !!room && room.status === 'active' && state.turn === mySeat && !isOver(state)

  const subunit: Subunit | null = useMemo(() => {
    if (!course || !room) return null
    const unit = course.units.find((u) => u.id === room.sel.unitId)
    return unit?.subunits.find((s) => s.id === room.sel.subunitId) ?? null
  }, [course, room])

  const pool = subunit?.questions ?? []
  // Seed + tick pick the question, so every screen shows the same one without
  // anyone having to write it into the document.
  const question: Question | null = pool.length > 0 && room
    ? pool[questionIndexFor(room.seed, room.tick, pool.length)]
    : null

  // ---- animate whatever the last committed turn did ------------------------
  useEffect(() => {
    if (!room || !state?.last) return
    if (seenTickRef.current === room.tick) return
    seenTickRef.current = room.tick
    const last = state.last
    if (!last.correct || last.roll <= 0) return
    const { path, chute } = resolveMove(last.from, last.roll)
    setBoardMove({ seq: room.tick, racer: last.seat, from: last.from, path, chute })
  }, [room, state])

  // ---- rewards, once, when somebody reaches the summit ---------------------
  useEffect(() => {
    if (!state || !isOver(state) || !seated || rewardedRef.current) return
    rewardedRef.current = true
    if (state.winner === mySeat) sfxWin()
    setReward(finishGame('ascend', ascendScoreFor(state, mySeat)))
  }, [state, seated, mySeat, finishGame])

  // Must include the invitees AND me: someone taking a seat is by definition not
  // in `members` yet, so looking up only members would never resolve their own
  // handle and the join would write their raw email in as their name.
  const names = useUsernames(
    room ? [...room.members, ...room.invited, ...(uid ? [uid] : [])] : [],
  )
  const nameOf = useCallback(
    (u: string) => room?.names[u] ?? displayNameFor(names[u], null),
    [room, names],
  )

  async function guard(action: () => Promise<unknown>, failure: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action() } catch (err) {
      console.error('[eclipse-arcade] table action failed:', err)
      setError(err instanceof Error ? err.message : failure)
    } finally { setBusy(false) }
  }

  function answer(correct: boolean) {
    if (!room || !state || !myTurn) return
    recordAnswer(correct)
    if (subunit) {
      answersRef.current.push({ subunitId: subunit.id, subunitName: subunit.name, correct })
    }
    if (correct) sfxPick(); else sfxDeny()
    // Nobody throws their own die. The roll comes from the table's shared seed
    // and this turn's number, so every other screen works out the same value and
    // a client that published a flattering six would be contradicted by all of
    // them (see moveIsHonest).
    const roll = correct ? rollForTurn(room.seed, room.tick) : 0
    const next = applyAscendAnswer(state, correct, roll)
    void guard(
      () => commitGameTransition(room.id, room.tick, ascendStateData(next), isOver(next)),
      'Could not send your turn — check your connection.',
    )
  }

  // ---- gates --------------------------------------------------------------
  if (!isFirebaseConfigured) return <Shell><Notice>Online play needs the arcade's cloud setup, which isn't configured here.</Notice></Shell>
  if (authLoading) return <Shell><Notice>Loading…</Notice></Shell>
  if (!user) return <Shell><Notice>Sign in to play with friends. <Link onClick={() => navigate('/friends')}>Go to Friends</Link></Notice></Shell>
  if (!emailVerified) return <Shell><Notice>Verify your email before joining a table.</Notice></Shell>
  if (missing) return <Shell><Notice>That table is no longer available. <Link onClick={() => navigate('/ascend')}>Back to Ascend</Link></Notice></Shell>
  if (!room || !state) return <Shell><Notice>Finding the table…</Notice></Shell>

  const iAmHost = room.host === uid
  const placings = ascendPlacements(state)

  return (
    <Shell onBack={() => navigate('/ascend')}>
      {error && <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{error}</p>}

      {room.status === 'lobby' && (
        <TableLobby
          room={room} uid={uid!} iAmHost={iAmHost} seated={seated} busy={busy}
          maxSeats={MAX_SEATS} accent={ACCENT} heading="THE CLIMB"
          blurb={subunit
            ? <>Everyone answers <span className="text-white/90">{subunit.name}</span>. A correct answer earns a roll — first to {LAST_SQUARE} wins.</>
            : 'Loading the topic…'}
          nameOf={nameOf}
          onInvite={(friendUid) => void guard(() => inviteToGameRoom(room.id, friendUid), 'Could not send that invite.')}
          onJoin={() => void guard(
            () => joinGameRoom(room.id, { uid: uid!, name: seatName(names[uid!], user.email) }, MAX_SEATS,
              (seats) => ascendStateData(createAscendState(seats))),
            'Could not take a seat.',
          )}
          onStart={() => void guard(() => startGameRoom(room.id, uid!), 'Could not start the climb.')}
          onLeave={() => void guard(async () => {
            await leaveGameRoom(room.id, uid!, MAX_SEATS, (seats) => ascendStateData(createAscendState(seats)))
            navigate('/ascend')
          }, 'Could not leave the table.')}
        />
      )}

      {room.status !== 'lobby' && (
        <div>
          <AscendBoard3D
            positions={state.positions}
            activeRacer={state.turn}
            move={boardMove}
            onMoveDone={() => setBoardMove(null)}
            reduced={isReducedMotion()}
          />

          <div className="mt-4 grid gap-2">
            {seats.map((u, seat) => (
              <Racer
                key={u ?? `empty-${seat}`}
                name={u ? nameOf(u) : 'Empty seat'}
                you={u === uid}
                square={state.positions[seat] ?? 0}
                correct={state.correct[seat] ?? 0}
                place={isOver(state) ? placings[seat] : 0}
                active={!isOver(state) && state.turn === seat}
              />
            ))}
          </div>

          {isOver(state) ? (
            <Finished
              won={state.winner === mySeat}
              winner={nameOf(seats[state.winner] ?? '')}
              reward={reward}
              level={levelFromXp(player.xp).level}
              answers={answersRef.current}
              iAmHost={iAmHost}
              onClose={() => void guard(async () => {
                if (iAmHost) await deleteGameRoom(room.id)
                navigate('/ascend')
              }, 'Could not close the table.')}
            />
          ) : myTurn ? (
            question
              ? <div className="mt-4"><QuestionPanel q={question} color={ACCENT} onSubmit={answer} surface="plain" label="ANSWER TO EARN YOUR ROLL" /></div>
              : <Notice>This topic has no questions right now.</Notice>
          ) : (
            <p className="mt-5 text-center font-sans text-sm text-white/70">
              {seated
                ? <>Waiting for <span className="font-semibold text-white">{nameOf(seats[state.turn] ?? '')}</span> to answer…</>
                : 'Watching this table.'}
            </p>
          )}
        </div>
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function Racer({ name, you, square, correct, place, active }: {
  name: string; you: boolean; square: number; correct: number; place: number; active: boolean
}) {
  const pct = Math.round((square / LAST_SQUARE) * 100)
  return (
    <div className={`rounded-lg border px-3 py-2 ${active ? 'border-neon-green/60 bg-neon-green/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-white/90">
          {place > 0 && <span className="font-pixel text-[9px] mr-2" style={{ color: ACCENT }}>{place}</span>}
          {name}{you && <span className="ml-2 text-xs text-white/45">you</span>}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-white/60">
          square {square} · {correct} right
        </span>
      </div>
      <div aria-hidden className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
      </div>
    </div>
  )
}

function Finished({ won, winner, reward, level, answers, iAmHost, onClose }: {
  won: boolean; winner: string; reward: { xp: number; coins: number; best: boolean } | null
  level: number; answers: readonly AnsweredItem[]; iAmHost: boolean; onClose: () => void
}) {
  return (
    <div className="mt-6 text-center">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: won ? ACCENT : '#ff9dbd' }}>
        {won ? 'You reached the summit!' : `${winner} reached the summit`}
      </div>
      {reward && (
        <>
          <div className="flex justify-center gap-3 my-4">
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold">
              <Coin width={18} height={18} /> +{reward.coins}
            </span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#9dffcf' }}>
              <Bolt width={18} height={18} /> +{reward.xp} XP
            </span>
          </div>
          {reward.best && (
            <div className="inline-flex items-center gap-1 font-sans font-bold text-[11px] tracking-wide px-2.5 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2">
              <Star width={12} height={12} /> NEW BEST
            </div>
          )}
          <div className="text-xs text-white/50 mb-6">Level {level}</div>
        </>
      )}
      <div className="text-left max-w-sm mx-auto mb-6">
        <SessionSummary summary={summarize(answers)} color={ACCENT} />
      </div>
      <button onClick={onClose}
        className="flex items-center gap-2 mx-auto font-pixel text-[11px] px-5 py-3 rounded-lg text-[#04331d]" style={BTN}>
        <Replay width={16} height={16} /> {iAmHost ? 'CLOSE TABLE' : 'BACK TO ASCEND'}
      </button>
    </div>
  )
}

// ---- small shared chrome --------------------------------------------------

function Shell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-5">
          <button aria-label="Back" onClick={onBack ?? (() => navigate('/ascend'))}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="font-pixel text-[11px]" style={{ color: ACCENT }}>ASCEND · TABLE</div>
          <div className="w-10" />
        </div>
        {children}
      </div>
    </div>
  )
}

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className="text-center text-sm text-white/70 py-12">{children}</p>
)

const Link = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="underline text-white/90 hover:text-white">{children}</button>
)
