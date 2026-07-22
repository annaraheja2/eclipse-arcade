// Live head-to-head Battleship over Firestore. See lib/social.ts for the
// protocol and trust model: this client only ever knows ITS OWN fleet (state +
// per-match localStorage); everything about the opponent arrives through the
// match doc and the shot log. On our turn we answer a question, fire a
// 'pending' shot, and wait for the opponent's client to adjudicate it; on
// their turn we adjudicate their shots against our local fleet.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Course, Subunit, Question } from '../data/subjects'
import { loadCourse } from '../lib/content'
import { FLEET, allSunk, type Ship } from '../lib/battleship'
import BattleGrid from '../components/BattleGrid'
import FleetPlacement from '../components/FleetPlacement'
import FleetPips from '../components/FleetPips'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer } from '../lib/player'
import { useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import {
  opponentOf, fleetWithHits, shotMarks, adjudicateShot, priorResultAt,
  loadStoredMatch, saveStoredMatch, wasRewarded, markRewarded,
  subscribeMatch, subscribeShots,
  acceptInvite, deleteInviteMatch, setReady, fireShot, resolveShot, passTurn, endMatch,
  type Match, type Shot, type StoredMatch,
} from '../lib/social'
import { useUsernames } from '../lib/useUsernames'
import { ArrowLeft, Volume, VolumeMute, Target } from '../icons'
import { sfxFire, sfxHit, sfxMiss, sfxSink, sfxWin, setMuted, isMuted } from '../lib/sound'

const CY = '#3df5ff'
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}
const STALE_MS = 60_000
const FIRED_MSG = 'Shot away — waiting for the impact report…'

const randomQ = (s: Subunit): Question => s.questions[Math.floor(Math.random() * s.questions.length)]

function findSubunit(course: Course, id: string): Subunit | null {
  for (const u of course.units) {
    const s = u.subunits.find((x) => x.id === id)
    if (s) return s
  }
  return null
}

export default function BattleshipPvp() {
  const { matchId = '' } = useParams()
  const navigate = useNavigate()
  const { finishGame } = usePlayer()
  const { user, loading: authLoading } = useAuth()

  const [match, setMatch] = useState<Match | null>(null)
  const [matchLoaded, setMatchLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [course, setCourse] = useState<Course | null>(null)
  const [muted, setMutedState] = useState(isMuted())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmForfeit, setConfirmForfeit] = useState(false)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // My side of the match — never leaves this device (see trust model).
  const [stored, setStored] = useState<StoredMatch | null>(() => (matchId ? loadStoredMatch(matchId) : null))
  const [placed, setPlaced] = useState<Ship[]>([])
  const [subunitId, setSubunitId] = useState<string | null>(stored?.subunitId ?? null)
  const [qPhase, setQPhase] = useState<'q' | 'aim'>('q')
  const [question, setQuestion] = useState<Question | null>(null)

  // ----- subscriptions (all detached on unmount) -----
  useEffect(() => {
    if (!user || !matchId || !isFirebaseConfigured) return
    const onError = (err: unknown) => {
      console.error('[eclipse-arcade] match subscription failed:', err)
      setLoadError('Could not load this match — it may not be yours, or your connection dropped.')
    }
    const unsubMatch = subscribeMatch(matchId, (m) => { setMatchLoaded(true); setMatch(m) }, onError)
    const unsubShots = subscribeShots(matchId, setShots, onError)
    return () => { unsubMatch(); unsubShots() }
  }, [user, matchId])

  useEffect(() => {
    if (!match) return
    let cancelled = false
    void loadCourse(match.courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [match?.courseId]) // reload only when the course id itself changes

  // Staleness clock — 5s resolution is plenty for a 60s threshold.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [])

  // ----- derived state -----
  const myUid = user?.uid ?? ''
  const oppUid = match ? opponentOf(match, myUid) : null
  const oppEmail = (oppUid && match?.emails[oppUid]) || 'your opponent'
  // Show the opponent by handle (falling back to email); the public usernames
  // collection is the only place another player's handle is readable.
  const oppUsernames = useUsernames(oppUid ? [oppUid] : [])
  const oppName = (oppUid && oppUsernames[oppUid]) || oppEmail
  const iAmCreator = match?.players[0] === myUid
  const myShots = shots.filter((s) => s.by === myUid)
  const oppShots = shots.filter((s) => s.by !== myUid)
  const resolvedOppShots = oppShots.filter((s) => s.result !== 'pending')
  const myFleet = stored ? fleetWithHits(stored.fleet, resolvedOppShots) : null
  const enemyMarks = shotMarks(myShots)
  const myMarks = shotMarks(oppShots)
  const pendingMine = myShots.some((s) => s.result === 'pending')
  const myTurn = match?.status === 'active' && match.turn === myUid && !pendingMine
  const enemySunk = myShots.filter((s) => s.result === 'sunk').length
  const sub = subunitId && course ? findSubunit(course, subunitId) : null
  const iAmReady = !!(match && match.ready[myUid])
  const oppReady = !!(match && oppUid && match.ready[oppUid])

  // A fleet saved earlier (e.g. READY failed mid-write, or a refresh before
  // locking in completed) seeds the placement board instead of a fresh shuffle.
  useEffect(() => {
    if (match?.status === 'placing' && !iAmReady && placed.length === 0 && stored) setPlaced(stored.fleet)
  }, [match?.status, iAmReady, placed.length, stored])

  // My own last action feeds the staleness clock (S10): a long think on MY
  // side must not flag the OPPONENT as inactive.
  const lastMyActionRef = useRef(0)

  // ----- defender: adjudicate the opponent's pending shots -----
  // Deliberately bounded (see trust model in lib/social.ts): we adjudicate
  // ONLY the single oldest pending opposing shot, and only while the turn is
  // still the shooter's — the only window in which an honest shot can exist.
  // A hacked shooter stockpiling extra 'pending' shots gets at most one
  // adjudicated per turn; the rest are ignored. Adjudication is idempotent
  // per cell: a cell we already resolved re-reports its prior result instead
  // of counting a second hit.
  const resolvingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!match || match.status !== 'active' || !user || !stored || !oppUid) return
    if (match.turn !== oppUid) return // an honest unresolved shot keeps the turn on the shooter
    const pendingAll = oppShots.filter((s) => s.result === 'pending')
    if (pendingAll.length === 0) return
    if (pendingAll.length > 1) {
      console.warn(`[eclipse-arcade] ${pendingAll.length} pending opposing shots — adjudicating only the oldest; extras ignored as implausible.`)
    }
    const pending = pendingAll[0] // oppShots is already in stable seq order
    if (resolvingRef.current.has(pending.id)) return
    resolvingRef.current.add(pending.id)
    const fleetNow = fleetWithHits(stored.fleet, resolvedOppShots)
    const prior = priorResultAt(resolvedOppShots, pending.r, pending.c)
    const { result, fleetSunk } = prior
      ? { result: prior, fleetSunk: allSunk(fleetNow) }
      : adjudicateShot(fleetNow, pending.r, pending.c)
    lastMyActionRef.current = Date.now()
    resolveShot(match.id, pending.id, result, user.uid, oppUid, fleetSunk).catch((err: unknown) => {
      console.error('[eclipse-arcade] shot adjudication failed:', err)
      resolvingRef.current.delete(pending.id) // retried on the next snapshot
      setActionError('Could not report the shot result — check your connection.')
    })
    // oppShots/resolvedOppShots derive from `shots`; the effect keys off the source.
  }, [shots, match, user, stored, oppUid])

  // ----- my turn: deal a fresh question exactly once per turn -----
  const turnKeyRef = useRef('')
  useEffect(() => {
    if (!match || match.status !== 'active' || !sub || !myTurn) return
    const key = `${match.turn}:${shots.length}:${match.updatedAtMs}`
    if (turnKeyRef.current === key) return
    turnKeyRef.current = key
    setQuestion(randomQ(sub))
    setQPhase('q')
    setMsg('')
  }, [match, myTurn, shots.length, sub])

  // ----- sounds for shot events (silent on the initial snapshot/refresh) -----
  const seenShots = useRef<Map<string, Shot['result']> | null>(null)
  useEffect(() => {
    if (seenShots.current === null) {
      seenShots.current = new Map(shots.map((s) => [s.id, s.result]))
      return
    }
    for (const s of shots) {
      const prev = seenShots.current.get(s.id)
      if (prev === s.result) continue
      seenShots.current.set(s.id, s.result)
      if (prev === undefined && s.result === 'pending') sfxFire()
      else if (s.result === 'miss') sfxMiss()
      else if (s.result === 'hit') sfxHit()
      else if (s.result === 'sunk') sfxSink()
    }
  }, [shots])

  // ----- rewards, exactly once per match (winner 3000, loser 500 — as vs AI) -----
  useEffect(() => {
    if (!match || match.status !== 'done' || !user || wasRewarded(match.id)) return
    markRewarded(match.id)
    const won = match.winner === user.uid
    finishGame('battleship', won ? 3000 : 500)
    if (won) sfxWin()
  }, [match, user, finishGame])

  // ----- actions -----
  async function run(action: () => Promise<void>, failMsg: string) {
    setActionError('')
    setBusy(true)
    try { await action() } catch (err) {
      console.error('[eclipse-arcade] match action failed:', err)
      setActionError(failMsg)
    } finally { setBusy(false) }
  }

  const accept = () => run(() => acceptInvite(matchId), 'Could not accept the invite — try again.')
  const declineOrCancel = () => run(async () => { await deleteInviteMatch(matchId); navigate('/battleship') }, 'Could not remove the invite — try again.')

  const lockIn = () => {
    if (placed.length === 0 || !user) return
    const next: StoredMatch = { fleet: placed, subunitId }
    if (!saveStoredMatch(matchId, next)) {
      // An unsaved fleet plus a refresh is an unrecoverable match — block READY.
      setActionError('Could not save your fleet on this device — free up storage or leave private browsing, then try again.')
      return
    }
    setStored(next)
    lastMyActionRef.current = Date.now()
    void run(() => setReady(matchId, user.uid), 'Could not lock in your fleet — try again.')
  }

  const forfeit = () => {
    setConfirmForfeit(false)
    if (!match || !oppUid) return
    void run(() => endMatch(match.id, oppUid, 'forfeit'), 'Could not forfeit — try again.')
  }
  const abandonStale = () => {
    if (!match || !user) return
    void run(() => endMatch(match.id, user.uid, 'timeout'), 'Could not close the match — try again.')
  }

  function onAnswer(correct: boolean) {
    if (!match || !oppUid || !myTurn) return
    if (correct) { setQPhase('aim'); setMsg('Correct! Take your shot.'); return }
    setMsg('Wrong — the turn passes to the enemy.')
    void run(() => passTurn(match.id, oppUid), 'Could not pass the turn — check your connection.')
  }

  // Synchronous double-fire guard: `myShots` lags the snapshot, so without
  // this ref a fast double-tap could file the same cell twice.
  const firedRef = useRef<Set<string>>(new Set())
  function fireAt(r: number, c: number) {
    if (!match || !myTurn || qPhase !== 'aim' || busy) return
    const cellKey = `${r},${c}`
    if (firedRef.current.has(cellKey) || myShots.some((s) => s.r === r && s.c === c)) return
    firedRef.current.add(cellKey)
    setMsg(FIRED_MSG)
    lastMyActionRef.current = Date.now()
    void run(
      () => fireShot(match.id, myUid, r, c, shots.length).catch((err: unknown) => {
        firedRef.current.delete(cellKey) // a failed fire may be retried
        throw err
      }),
      'Could not fire — check your connection.'
    )
  }

  // Clear the "waiting for the impact report" line once the shot resolves.
  useEffect(() => {
    if (!pendingMine) setMsg((m) => (m === FIRED_MSG ? '' : m))
  }, [pendingMine])

  // ----- staleness (opponent inactive while we wait on them) -----
  // My own actions count too (S10): the threshold measures silence since the
  // LAST thing either side did, not just the opponent's last server write.
  const lastActivityMs = Math.max(
    match?.updatedAtMs ?? 0, lastMyActionRef.current, ...shots.map((s) => s.createdAtMs))
  const waitingOnOpponent =
    (match?.status === 'placing' && iAmReady && !oppReady) ||
    (match?.status === 'active' && (match.turn !== myUid || pendingMine))
  const staleOpponent = waitingOnOpponent && lastActivityMs > 0 && now - lastActivityMs > STALE_MS

  // ================= RENDER =================
  const body = (() => {
    if (!isFirebaseConfigured) return <Note>Online play is unavailable in this build.</Note>
    if (authLoading) return <Loading label="CONNECTING…" />
    if (!user) {
      return (
        <Note>
          Sign in from the <Link to="/" className="text-neon-cyan underline underline-offset-4">lobby</Link> to join this battle.
        </Note>
      )
    }
    // A deleted match (declined/cancelled invite) outranks listener errors —
    // the shots listener loses read permission the moment the doc disappears.
    if (matchLoaded && !match) {
      return (
        <div className="text-center py-12">
          <p className="text-white/65 mb-6">This match no longer exists — the invite was declined or cancelled.</p>
          <BackToBattleship />
        </div>
      )
    }
    if (loadError) return <Note role="alert">{loadError}</Note>
    if (!matchLoaded || !match) return <Loading label="LOADING MATCH…" />
    if (!oppUid) return <Note role="alert">This match belongs to two other players.</Note>

    if (match.status === 'invite') {
      return iAmCreator ? (
        <Section title="INVITE SENT">
          <div className="text-center py-8">
            <p className="font-pixel text-[11px] text-neon-cyan mb-3" aria-live="polite">
              <span className="blink-attract">WAITING FOR {oppName.toUpperCase()}…</span>
            </p>
            <p className="text-sm text-white/65 mb-6">The battle starts as soon as they accept.</p>
            {actionError && <ErrorLine text={actionError} />}
            <Btn onClick={declineOrCancel} disabled={busy}>CANCEL INVITE</Btn>
          </div>
        </Section>
      ) : (
        <Section title="CHALLENGE RECEIVED">
          <div className="text-center py-8">
            <p className="text-white/90 mb-6"><span className="font-semibold">{oppName}</span> challenges you to Battleship.</p>
            {actionError && <ErrorLine text={actionError} />}
            <div className="flex justify-center gap-3">
              <button onClick={accept} disabled={busy}
                className="arcade-btn font-pixel text-[10px] px-5 py-3 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                ACCEPT
              </button>
              <Btn onClick={declineOrCancel} disabled={busy}>DECLINE</Btn>
            </div>
          </div>
        </Section>
      )
    }

    if (match.status === 'placing') {
      if (iAmReady) {
        return (
          <Section title="FLEET DEPLOYED">
            <p className="font-pixel text-[10px] text-neon-cyan text-center mb-4" aria-live="polite">
              <span className="blink-attract">WAITING FOR {oppName.toUpperCase()}…</span>
            </p>
            {stored && (
              <div className="flex justify-center mb-6">
                <BattleGrid ships={stored.fleet} shots={{}} showShips disabled />
              </div>
            )}
            {staleOpponent && <StaleNotice email={oppName} onAbandon={abandonStale} busy={busy} />}
            {actionError && <ErrorLine text={actionError} />}
            <div className="flex justify-center"><ForfeitControl confirm={confirmForfeit} setConfirm={setConfirmForfeit} onForfeit={forfeit} busy={busy} /></div>
          </Section>
        )
      }
      if (!course) return <Loading label="LOADING COURSE…" />
      if (!sub) {
        return (
          <Section title="PICK YOUR TOPIC">
            <p className="text-center text-sm text-white/65 mb-4">These are the questions YOU answer to earn shots — {oppName} picks their own.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {course.units.flatMap((u) => u.subunits.map((s) => {
                const empty = s.questions.length === 0
                return (
                  <button key={s.id} onClick={() => setSubunitId(s.id)} disabled={empty}
                    className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 transition enabled:hover:border-neon-cyan/60 disabled:opacity-45 disabled:cursor-default">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{s.name}</span>
                      <span className="text-[9px] font-pixel px-2 py-1 rounded" style={{
                        background: `${s.difficulty === 'easy' ? '#3dffa2' : s.difficulty === 'medium' ? '#ffb43d' : '#ff4d8d'}22`,
                        color: s.difficulty === 'easy' ? '#3dffa2' : s.difficulty === 'medium' ? '#ffb43d' : '#ff4d8d',
                      }}>{s.difficulty.toUpperCase()}</span>
                    </div>
                    <div className="text-xs text-white/60 mt-1 uppercase tracking-wide">{u.name} · {empty ? 'no questions yet' : s.type}</div>
                  </button>
                )
              }))}
            </div>
          </Section>
        )
      }
      return (
        <Section title="DEPLOY YOUR FLEET">
          {actionError && <ErrorLine text={actionError} />}
          <FleetPlacement placed={placed} onChange={setPlaced}
            actions={
              <button onClick={lockIn} disabled={busy}
                className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60" style={CY_BTN}>
                READY
              </button>
            } />
          <div className="flex justify-center mt-5"><ForfeitControl confirm={confirmForfeit} setConfirm={setConfirmForfeit} onForfeit={forfeit} busy={busy} /></div>
        </Section>
      )
    }

    if (match.status === 'active') {
      if (!myFleet) {
        return (
          <div className="text-center py-12">
            <p role="alert" className="text-white/80 mb-2 font-semibold">Your fleet data is missing on this device.</p>
            <p className="text-sm text-white/65 mb-6">The fleet only ever lives in this browser — without it the battle can't continue here.</p>
            <ForfeitControl confirm={confirmForfeit} setConfirm={setConfirmForfeit} onForfeit={forfeit} busy={busy} />
          </div>
        )
      }
      const statusLine = msg !== '' ? msg
        : myTurn
          ? (qPhase === 'q' ? 'Your turn — answer to earn a shot.' : 'Direct your fire — tap the enemy waters.')
          : pendingMine ? FIRED_MSG : `${oppName} is taking their turn…`
      const lastMine = myShots.length > 0 ? myShots[myShots.length - 1] : undefined
      const lastTheirs = resolvedOppShots.length > 0 ? resolvedOppShots[resolvedOppShots.length - 1] : undefined
      return (
        <div>
          <div className="flex items-center justify-between mb-3">
            <EnemyPips sunk={enemySunk} />
            <FleetPips ships={myFleet} color={CY} label={`FLEET ${myFleet.filter((s) => s.hits < s.size).length}`} align="right" />
          </div>

          <div className="text-center mb-2">
            <div className="font-pixel text-[10px] text-white/60">ENEMY WATERS — {oppName.toUpperCase()}</div>
          </div>
          <div className="flex justify-center mb-4">
            <BattleGrid ships={[]} shots={enemyMarks} showShips={false}
              lastShot={lastMine ? `${lastMine.r},${lastMine.c}` : undefined}
              disabled={!myTurn || qPhase !== 'aim' || busy} onCell={fireAt} />
          </div>

          <div className="min-h-6 text-center font-pixel text-[11px] mb-2" style={{ color: CY }} aria-live="polite">{statusLine}</div>
          {actionError && <ErrorLine text={actionError} />}
          {staleOpponent && <StaleNotice email={oppName} onAbandon={abandonStale} busy={busy} />}

          {myTurn && qPhase === 'q' && question
            ? <QuestionPanel q={question} color={CY} onSubmit={onAnswer} />
            : myTurn && qPhase === 'aim'
              ? <p className="flex items-center justify-center gap-2 text-white/70 text-sm mb-4"><Target width={16} height={16} className="text-neon-cyan" />Tap the enemy waters to fire!</p>
              : null}

          <div className="mt-5">
            <div className="text-center font-pixel text-[9px] text-white/60 mb-1">YOUR FLEET</div>
            <div className="flex justify-center">
              <BattleGrid ships={myFleet} shots={myMarks} showShips disabled small
                lastShot={lastTheirs ? `${lastTheirs.r},${lastTheirs.c}` : undefined} />
            </div>
          </div>

          <div className="flex justify-center mt-6">
            <ForfeitControl confirm={confirmForfeit} setConfirm={setConfirmForfeit} onForfeit={forfeit} busy={busy} />
          </div>
        </div>
      )
    }

    // done
    const won = match.winner === myUid
    const detail =
      match.endReason === 'forfeit'
        ? (won ? `${oppName} forfeited the battle.` : 'You forfeited the battle.')
        : match.endReason === 'timeout'
          ? (won ? `${oppName} went inactive — the match was closed.` : 'The match was closed for inactivity.')
          : won ? `You sank ${oppName}'s fleet.` : `${oppName} sank your fleet.`
    return (
      <div className="text-center py-12">
        <div className="font-pixel text-2xl mb-4" style={{ color: won ? '#3dffa2' : '#ff4d8d' }} aria-live="polite">
          {won ? 'VICTORY!' : 'DEFEATED'}
        </div>
        <p className="text-white/50 mb-6">{detail}</p>
        <div className="flex justify-center gap-3">
          <BackToBattleship />
          <button onClick={() => navigate('/')} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">ARCADE</button>
        </div>
      </div>
    )
  })()

  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={() => navigate('/battleship')} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="font-pixel text-[12px]" style={{ color: CY }}>BATTLESHIP LIVE</div>
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>
        {body}
      </div>
    </div>
  )
}

// The enemy fleet is unknowable by design — only the count of confirmed sinks
// is public, so the pips are generic ship markers, dimmed as they go down.
function EnemyPips({ sunk }: { sunk: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-pixel text-[8px] text-white/60">ENEMY {FLEET.length - sunk}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {FLEET.map((f, i) => (
          <span key={f.id} className="h-[6px] rounded-[2px] transition-all" style={{
            width: f.size * 5,
            background: i < sunk ? 'rgba(255,255,255,0.14)' : '#ff4d8d',
            boxShadow: i < sunk ? 'none' : '0 0 6px #ff4d8d99',
          }} />
        ))}
      </span>
    </div>
  )
}

function ForfeitControl({ confirm, setConfirm, onForfeit, busy }: {
  confirm: boolean; setConfirm: (v: boolean) => void; onForfeit: () => void; busy: boolean
}) {
  if (!confirm) {
    return (
      <button onClick={() => setConfirm(true)} disabled={busy}
        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-60">
        FORFEIT MATCH
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-sm text-white/80">Concede the battle?</span>
      <button onClick={onForfeit} disabled={busy}
        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-[#ff4d8d] text-[#2a0512] disabled:opacity-60">
        CONFIRM
      </button>
      <button onClick={() => setConfirm(false)} disabled={busy}
        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-60">
        KEEP PLAYING
      </button>
    </div>
  )
}

function StaleNotice({ email, onAbandon, busy }: { email: string; onAbandon: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-neon-amber/40 bg-neon-amber/10 p-4 mb-4 text-center" role="status">
      <p className="text-sm text-white/90 mb-3">{email} hasn't made a move in over a minute — they may have left.</p>
      <button onClick={onAbandon} disabled={busy}
        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-neon-amber text-[#2a1a00] disabled:opacity-60">
        ABANDON MATCH
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div><h2 className="font-pixel text-[11px] tracking-wider text-neon-cyan neon-text mb-5 text-center">{title}</h2>{children}</div>
}
function Btn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 transition-all hover:bg-white/10 hover:border-neon-cyan/40 active:scale-95 disabled:opacity-60">{children}</button>
}
function Note({ children, role }: { children: ReactNode; role?: 'alert' }) {
  return <p role={role} className="text-center text-white/70 py-16">{children}</p>
}
function Loading({ label }: { label: string }) {
  return <p className="text-center text-white/70 font-pixel text-[10px] py-16">{label}</p>
}
function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{text}</p>
}
function BackToBattleship() {
  return (
    <Link to="/battleship" className="arcade-btn inline-block font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={CY_BTN}>
      BATTLESHIP
    </Link>
  )
}
