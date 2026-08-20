// Racer, with friends on the same track.
//
// Nothing about the race is shared state. Each driver runs the SAME local
// simulation the solo race runs — answer right, go faster; answer wrong, slow
// down — and publishes only where they are and how fast. Everyone else fills the
// gaps by dead reckoning (lib/racerRoom.ts), so the track stays smooth on a
// couple of writes a driver per few seconds rather than one a frame.
//
// Questions aren't coordinated either: each driver works through the shared pool
// at their own pace, which is the point of a race.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { usePlayer, levelFromXp } from '../lib/player'
import { loadCourse } from '../lib/content'
import { isFirebaseConfigured } from '../lib/firebase'
import type { Course, Question, Subunit } from '../data/subjects'
import {
  subscribeGameRoom, inviteToGameRoom, joinGameRoom, leaveGameRoom, startGameRoom,
  deleteGameRoom, publishRacerProgress, subscribeRacers, type GameRoom,
} from '../lib/gameroom'
import {
  standings, projectedDistance, shouldPublish, toRacerProgress, racerProgressData,
  secondsLeft, type RacerProgress,
} from '../lib/racerRoom'
// Chairs and opening state come from the one registry every seating surface
// reads, so the JOIN button here and an accepted invite agree.
import { tableRules } from '../lib/gameTables'
import { applyAnswer, advanceDistance, raceScore, START_MPH, RACE_SECONDS, type Car } from '../lib/racer'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor, seatName } from '../lib/username'
import TableLobby from '../components/TableLobby'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, type AnsweredItem } from '../lib/summary'
import { isReducedMotion } from '../lib/motion'
import { sfxPick, sfxDeny, sfxWin } from '../lib/sound'
import { ArrowLeft, Coin, Bolt, Star } from '../icons'

const CircuitGL = lazy(() => import('../components/CircuitGL'))

const ACCENT = '#4d8dff'
const TABLE = tableRules('racer')
const MAX_SEATS = TABLE.maxSeats
// Car colours, assigned by seat so every screen paints the field the same.
const LIVERY = ['#4d8dff', '#ff4d8d', '#3dffa2', '#ffb43d'] as const

export default function RacerOnline() {
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
  const [others, setOthers] = useState<RacerProgress[]>([])
  const [tick, setTick] = useState(0) // repaints the HUD once a second
  const [q, setQ] = useState<Question | null>(null)
  const [done, setDone] = useState(false)
  const [reward, setReward] = useState<{ xp: number; coins: number; best: boolean } | null>(null)

  // My own car, driven by the rAF loop. Refs, because the loop must read the
  // current values every frame rather than a render's snapshot.
  const meRef = useRef({ distance: 0, speed: START_MPH })
  const lastPublishedRef = useRef<RacerProgress | null>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)
  const answersRef = useRef<AnsweredItem[]>([])
  const askedRef = useRef(0)
  const rewardedRef = useRef(false)
  const [field, setField] = useState<Car[]>([])

  // ---- feeds --------------------------------------------------------------
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

  useEffect(() => {
    if (!roomId || !uid || !isFirebaseConfigured) return
    return subscribeRacers<RacerProgress>(
      roomId,
      (id, data) => (id === uid ? null : toRacerProgress(id, data)), // my own car is local
      setOthers,
      (err) => console.error('[eclipse-arcade] racer feed failed:', err),
    )
  }, [roomId, uid])

  useEffect(() => {
    const courseId = room?.sel.courseId
    if (!courseId) return
    let cancelled = false
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [room?.sel.courseId])

  const seats = room?.seatUids ?? []
  const mySeat = room && uid ? seats.indexOf(uid) : -1
  const seated = mySeat >= 0
  const racing = room?.status === 'active' && !done

  const subunit: Subunit | null = useMemo(() => {
    if (!course || !room) return null
    const unit = course.units.find((u) => u.id === room.sel.unitId)
    return unit?.subunits.find((s) => s.id === room.sel.subunitId) ?? null
  }, [course, room])
  const pool = useMemo(() => subunit?.questions ?? [], [subunit])

  const raceStartMs = room?.turnStartedAtMs || 0
  const left = raceStartMs ? secondsLeft(Date.now(), raceStartMs) : RACE_SECONDS

  const names = useUsernames(
    room ? [...room.members, ...room.invited, ...(uid ? [uid] : [])] : [],
  )
  const nameOf = useCallback(
    (u: string) => room?.names[u] ?? displayNameFor(names[u], null),
    [room, names],
  )

  /** The next question for ME. Nobody coordinates these — it's a race. */
  const drawQuestion = useCallback(() => {
    if (pool.length === 0) { setQ(null); return }
    const seed = (room?.seed ?? 0) + (mySeat >= 0 ? mySeat * 7919 : 0)
    const picked = pool[(seed + askedRef.current) % pool.length]
    askedRef.current += 1
    setQ({ ...picked }) // fresh identity so QuestionPanel clears its inputs
  }, [pool, room?.seed, mySeat])

  // ---- the race loop ------------------------------------------------------
  useEffect(() => {
    if (!racing || !raceStartMs || !seated || !roomId || !uid) return
    lastFrameRef.current = performance.now()
    if (!q) drawQuestion()

    const frame = (t: number) => {
      const dt = Math.min(0.25, (t - lastFrameRef.current) / 1000)
      lastFrameRef.current = t
      const me = meRef.current
      me.distance = advanceDistance(me.distance, me.speed, dt)

      const now = Date.now()
      const over = secondsLeft(now, raceStartMs) <= 0
      if (shouldPublish(lastPublishedRef.current, me.speed, now, false) || over) {
        const payload: RacerProgress = {
          uid, distance: me.distance, speed: me.speed, atMs: now, finished: over,
        }
        lastPublishedRef.current = payload
        void publishRacerProgress(roomId, uid, racerProgressData(payload))
          .catch((err) => console.error('[eclipse-arcade] could not publish position:', err))
      }
      if (over) { setDone(true); return }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [racing, raceStartMs, seated, roomId, uid, q, drawQuestion])

  // Repaint the standings and the clock once a second — the cars themselves are
  // redrawn from `field` below, which the same tick rebuilds.
  useEffect(() => {
    if (!racing) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [racing])

  // Rebuild the field the circuit renders: my live car plus everyone else's,
  // dead-reckoned to now.
  useEffect(() => {
    if (!room || !uid) return
    const now = Date.now()
    const cars: Car[] = room.members.map((u, i) => {
      const livery = LIVERY[i % LIVERY.length]
      if (u === uid) {
        return {
          kind: 'player', id: u, name: nameOf(u), color: livery,
          speed: meRef.current.speed, distance: meRef.current.distance,
        }
      }
      const p = others.find((o) => o.uid === u)
      return {
        kind: 'player', id: u, name: nameOf(u), color: livery,
        speed: p?.speed ?? 0,
        distance: p ? projectedDistance(p, now) : 0,
      }
    })
    setField(cars)
  }, [room, uid, others, tick, nameOf, done])

  // ---- rewards, once ------------------------------------------------------
  useEffect(() => {
    if (!done || !seated || rewardedRef.current || !uid) return
    rewardedRef.current = true
    const now = Date.now()
    const all: RacerProgress[] = [
      { uid, distance: meRef.current.distance, speed: 0, atMs: now, finished: true },
      ...others,
    ]
    const place = standings(all, now).findIndex((s) => s.uid === uid) + 1
    if (place === 1) sfxWin()
    setReward(finishGame('racer', raceScore(meRef.current.distance, place)))
  }, [done, seated, uid, others, finishGame])

  async function guard(action: () => Promise<unknown>, failure: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action() } catch (err) {
      console.error('[eclipse-arcade] table action failed:', err)
      setError(err instanceof Error ? err.message : failure)
    } finally { setBusy(false) }
  }

  function onAnswer(correct: boolean) {
    if (!racing || !uid || !roomId) return
    recordAnswer(correct)
    if (subunit) {
      answersRef.current.push({ subunitId: subunit.id, subunitName: subunit.name, correct })
    }
    if (correct) sfxPick(); else sfxDeny()
    const me = meRef.current
    me.speed = applyAnswer(me.speed, correct)
    // An answer changes speed, so everyone else's guess is stale until they hear
    // about it — publish straight away rather than waiting for the heartbeat.
    const now = Date.now()
    const payload: RacerProgress = { uid, distance: me.distance, speed: me.speed, atMs: now, finished: false }
    lastPublishedRef.current = payload
    void publishRacerProgress(roomId, uid, racerProgressData(payload))
      .catch((err) => console.error('[eclipse-arcade] could not publish position:', err))
    drawQuestion()
  }

  // ---- gates --------------------------------------------------------------
  if (!isFirebaseConfigured) return <Shell><Notice>Online play needs the arcade's cloud setup, which isn't configured here.</Notice></Shell>
  if (authLoading) return <Shell><Notice>Loading…</Notice></Shell>
  if (!user) return <Shell><Notice>Sign in to race your friends.</Notice></Shell>
  if (!emailVerified) return <Shell><Notice>Verify your email before joining a race.</Notice></Shell>
  if (missing) return <Shell><Notice>That race is no longer available.</Notice></Shell>
  if (!room) return <Shell><Notice>Finding the grid…</Notice></Shell>

  const iAmHost = room.host === uid
  const board = standings(
    [
      ...(seated ? [{ uid: uid!, distance: meRef.current.distance, speed: meRef.current.speed, atMs: Date.now(), finished: done }] : []),
      ...others,
    ],
    Date.now(),
  )

  return (
    <Shell onBack={() => navigate('/racer')}>
      {error && <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{error}</p>}

      {room.status === 'lobby' && (
        <TableLobby
          room={room} uid={uid!} iAmHost={iAmHost} seated={seated} busy={busy}
          maxSeats={MAX_SEATS} accent={ACCENT} heading="THE GRID"
          blurb={subunit
            ? <>Everyone answers <span className="text-white/90">{subunit.name}</span>. Right answers speed you up, wrong ones slow you down — furthest in {RACE_SECONDS / 60} minutes wins.</>
            : 'Loading the topic…'}
          nameOf={nameOf}
          onInvite={(f) => void guard(() => inviteToGameRoom(room.id, f), 'Could not send that invite.')}
          onJoin={() => void guard(
            () => joinGameRoom(room.id, { uid: uid!, name: seatName(names[uid!], user.email) },
              TABLE.maxSeats, TABLE.seatState),
            'Could not take a seat.',
          )}
          onStart={() => void guard(() => startGameRoom(room.id, uid!), 'Could not start the race.')}
          onLeave={() => void guard(async () => {
            await leaveGameRoom(room.id, uid!, TABLE.maxSeats, TABLE.seatState)
            navigate('/racer')
          }, 'Could not leave the grid.')}
        />
      )}

      {room.status !== 'lobby' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="font-pixel text-[10px] text-white/60">
              {done ? 'CHEQUERED FLAG' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} LEFT`}
            </span>
            <span className="font-pixel text-[10px]" style={{ color: ACCENT }}>
              {Math.round(meRef.current.speed)} MPH
            </span>
          </div>

          <Suspense fallback={<div className="h-56 rounded-2xl bg-white/[0.03] border border-white/10 grid place-items-center text-sm text-white/50">Warming the engines…</div>}>
            <CircuitGL field={field} youId={uid!} reduced={isReducedMotion()} flagged={done} />
          </Suspense>

          <ul className="mt-4 grid gap-2">
            {board.map((s) => (
              <li key={s.uid} className={`rounded-lg border px-3 py-2 ${s.uid === uid ? 'border-white/25 bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-white/90">
                    <span className="font-pixel text-[9px] mr-2" style={{ color: ACCENT }}>P{s.place}</span>
                    {nameOf(s.uid)}
                    {s.uid === uid && <span className="ml-2 text-xs text-white/45">you</span>}
                    {s.stale && <span className="ml-2 text-xs text-white/40">(lost contact)</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-white/60">
                    {Math.round(s.fraction * 100)}%
                  </span>
                </div>
                <div aria-hidden className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                    style={{ width: `${Math.round(s.fraction * 100)}%`, background: LIVERY[room.members.indexOf(s.uid) % LIVERY.length] }} />
                </div>
              </li>
            ))}
          </ul>

          {done ? (
            <Finished
              place={board.findIndex((s) => s.uid === uid) + 1}
              reward={reward}
              level={levelFromXp(player.xp).level}
              answers={answersRef.current}
              iAmHost={iAmHost}
              onClose={() => void guard(async () => {
                if (iAmHost) await deleteGameRoom(room.id)
                navigate('/racer')
              }, 'Could not close the table.')}
            />
          ) : seated && q ? (
            <div className="mt-4">
              <QuestionPanel q={q} color={ACCENT} onSubmit={onAnswer} surface="plain" label="ANSWER TO ACCELERATE" />
            </div>
          ) : seated ? (
            <Notice>This topic has no questions right now.</Notice>
          ) : (
            <p className="mt-5 text-center text-sm text-white/70">Watching this race.</p>
          )}
        </div>
      )}
    </Shell>
  )
}

function Finished({ place, reward, level, answers, iAmHost, onClose }: {
  place: number
  reward: { xp: number; coins: number; best: boolean } | null
  level: number; answers: readonly AnsweredItem[]; iAmHost: boolean; onClose: () => void
}) {
  const won = place === 1
  return (
    <div className="mt-6 text-center">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: won ? ACCENT : '#ff9dbd' }}>
        {won ? 'Race winner!' : `P${place} finish`}
      </div>
      {reward && (
        <>
          <div className="flex justify-center gap-3 my-4">
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold">
              <Coin width={18} height={18} /> +{reward.coins}
            </span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#9dc2ff' }}>
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
        className="font-pixel text-[11px] px-5 py-3 rounded-lg" style={{ background: ACCENT, color: '#06122b' }}>
        {iAmHost ? 'CLOSE TABLE' : 'BACK TO RACER'}
      </button>
    </div>
  )
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-5">
          <button aria-label="Back" onClick={onBack ?? (() => navigate('/racer'))}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="font-pixel text-[11px]" style={{ color: ACCENT }}>RACER · GRID</div>
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
