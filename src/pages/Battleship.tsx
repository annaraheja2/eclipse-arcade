import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { COURSES, type Course, type Unit, type Subunit, type Question } from '../data/subjects'
import { loadCourse } from '../lib/content'
import {
  randomFleet, allSunk, isSunk, keyOf, aiPick, applyFire,
  type Ship,
} from '../lib/battleship'
import BattleGrid, { type Shots } from '../components/BattleGrid'
import FleetPlacement from '../components/FleetPlacement'
import FleetPips from '../components/FleetPips'
import QuestionPanel from '../components/QuestionPanel'
import VerifyEmailNotice from '../components/VerifyEmailNotice'
import { usePlayer } from '../lib/player'
import { useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import {
  subscribeFriendships, subscribeMyMatches, createInviteMatch,
  joinQueue, leaveQueue, attemptPair,
  type Friendship,
} from '../lib/social'
import { ArrowLeft, Volume, VolumeMute, Target } from '../icons'
import { sfxFire, sfxHit, sfxMiss, sfxSink, sfxWin, setMuted, isMuted } from '../lib/sound'

const CY = '#3df5ff'
// accent vars for the `.arcade-btn` chunky-button chrome (see index.css)
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}
const COURSE_ID = COURSES[0].id // Algebra 1 (from profile later)

function impactSound(result: 'miss' | 'hit' | 'sunk') {
  sfxFire()
  setTimeout(() => (result === 'miss' ? sfxMiss() : result === 'sunk' ? sfxSink() : sfxHit()), 320)
}

type Phase = 'mode' | 'friend' | 'queue' | 'unit' | 'subunit' | 'place' | 'battle' | 'over'
interface Battle { enemy: Ship[]; placed: Ship[]; pShots: Shots; eShots: Shots; phase: 'q' | 'aim'; q: Question; msg: string; busy: boolean; lastP?: string; lastE?: string }

const randomQ = (s: Subunit): Question => s.questions[Math.floor(Math.random() * s.questions.length)]
const remaining = (ships: Ship[]) => ships.filter((s) => !isSunk(s)).length

export default function Battleship() {
  const navigate = useNavigate()
  const { finishGame } = usePlayer()
  const { user, loading: authLoading, emailVerified } = useAuth()
  const [ph, setPh] = useState<Phase>('mode')
  // Firestore-backed when configured; loadCourse falls back to the bundled
  // course on any failure, so null only ever means "still loading".
  const [course, setCourse] = useState<Course | null>(null)
  const [unit, setUnit] = useState<Unit | null>(null)
  const [sub, setSub] = useState<Subunit | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadCourse(COURSE_ID).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [])

  const [placed, setPlaced] = useState<Ship[]>([])
  const [battle, setBattle] = useState<Battle | null>(null)
  const [winner, setWinner] = useState<'you' | 'ai' | null>(null)
  const [rewarded, setRewarded] = useState(false)
  const [muted, setMutedState] = useState(isMuted())

  const battleRef = useRef<Battle | null>(battle)
  useEffect(() => { battleRef.current = battle }, [battle])

  // ----- online state (friend invites + quick match) -----
  const [friends, setFriends] = useState<Friendship[] | null>(null)
  const [onlineError, setOnlineError] = useState('')
  const [invitingUid, setInvitingUid] = useState<string | null>(null)

  useEffect(() => {
    if (ph !== 'friend' || !user) return
    setFriends(null)
    setOnlineError('')
    return subscribeFriendships(
      user.uid,
      setFriends,
      (err) => { console.error('[eclipse-arcade] friends load failed:', err); setOnlineError('Could not load your friends — check your connection and try again.') }
    )
  }, [ph, user])

  async function inviteFriend(f: Friendship) {
    if (!user || invitingUid) return
    const idx = f.uids[0] === user.uid ? 1 : 0
    setInvitingUid(f.uids[idx])
    setOnlineError('')
    try {
      const id = await createInviteMatch(
        { uid: user.uid, email: (user.email ?? '').toLowerCase() },
        { uid: f.uids[idx], email: f.emails[idx] },
        COURSE_ID
      )
      navigate(`/battleship/pvp/${id}`)
    } catch (err) {
      console.error('[eclipse-arcade] invite failed:', err)
      setOnlineError('Could not send the invite — try again.')
      setInvitingUid(null)
    }
  }

  // Quick match: establish the match-subscription BASELINE first (so a match
  // created the instant we become discoverable can't be mistaken for a
  // pre-existing one), then put our queue doc up and try to pair with the
  // oldest waiting player. If nobody's there we stay queued; the next
  // joiner's transaction creates the match, which our subscription spots
  // (any placing match not present in the baseline snapshot).
  useEffect(() => {
    if (ph !== 'queue' || !user) return
    let active = true
    const uid = user.uid
    const email = (user.email ?? '').toLowerCase()
    setOnlineError('')
    let initialIds: Set<string> | null = null
    let baselineReady!: () => void
    const baseline = new Promise<void>((resolve) => { baselineReady = resolve })
    const unsub = subscribeMyMatches(uid, (ms) => {
      if (!active) return
      if (initialIds === null) { initialIds = new Set(ms.map((m) => m.id)); baselineReady(); return }
      const fresh = ms.find((m) => m.status === 'placing' && !initialIds!.has(m.id))
      if (fresh) { active = false; navigate(`/battleship/pvp/${fresh.id}`) }
    }, (err) => {
      console.error('[eclipse-arcade] queue watch failed:', err)
      if (active) { active = false; baselineReady(); setOnlineError('Matchmaking failed — check your connection and try again.'); setPh('mode') }
    })
    void (async () => {
      try {
        await baseline // don't join until the baseline snapshot is captured
        if (!active) return
        await joinQueue(uid, email)
        const matchId = await attemptPair(uid, email, COURSE_ID)
        if (matchId && active) { active = false; navigate(`/battleship/pvp/${matchId}`) }
      } catch (err) {
        console.error('[eclipse-arcade] quick match failed:', err)
        if (active) { setOnlineError('Matchmaking failed — check your connection and try again.'); setPh('mode') }
      }
    })()
    return () => {
      active = false
      baselineReady() // release the joiner if we unmount before the first snapshot
      unsub()
      leaveQueue(uid).catch((err: unknown) => console.error('[eclipse-arcade] leave queue failed:', err))
    }
  }, [ph, user, navigate])

  // ----- vs-AI battle (unchanged) -----

  // Game-over detection.
  useEffect(() => {
    if (ph !== 'battle' || !battle) return
    if (allSunk(battle.enemy)) { setWinner('you'); setPh('over') }
    else if (allSunk(battle.placed)) { setWinner('ai'); setPh('over') }
  }, [battle, ph])

  useEffect(() => {
    if (ph === 'over' && !rewarded) {
      finishGame('battleship', winner === 'you' ? 3000 : 500)
      if (winner === 'you') sfxWin()
      setRewarded(true)
    }
  }, [ph, rewarded, winner, finishGame])

  function startBattle() {
    if (!sub) return
    setBattle({ enemy: randomFleet(), placed, pShots: {}, eShots: {}, phase: 'q', q: randomQ(sub), msg: '', busy: false })
    setPh('battle')
  }

  function onAnswer(correct: boolean) {
    setBattle((b) => b && { ...b, phase: correct ? 'aim' : b.phase, busy: !correct, msg: correct ? 'Correct! Take your shot.' : 'Wrong! Enemy returns fire…' })
    if (!correct) aiTurn()
  }
  function fireAtEnemy(r: number, c: number) {
    const b = battleRef.current
    if (!b || b.phase !== 'aim' || b.busy || b.pShots[keyOf(r, c)]) return
    const { ships, result } = applyFire(b.enemy, r, c)
    const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
    impactSound(result)
    setBattle((cur) => cur && ({
      ...cur, enemy: ships, pShots: { ...cur.pShots, [keyOf(r, c)]: mark }, lastP: keyOf(r, c), busy: true,
      msg: result === 'sunk' ? 'Enemy ship SUNK!' : result === 'hit' ? 'Direct hit!' : 'Splash — miss.',
    }))
    aiTurn()
  }
  function aiTurn() {
    setTimeout(() => {
      const b = battleRef.current
      if (!b || allSunk(b.enemy)) { setBattle((c) => c && ({ ...c, busy: false })); return } // player already won
      const cell = aiPick(new Set(Object.keys(b.eShots)))
      const { ships, result } = applyFire(b.placed, cell.r, cell.c)
      const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
      impactSound(result)
      const over = allSunk(ships)
      setBattle((cur) => cur && ({
        ...cur, placed: ships, eShots: { ...cur.eShots, [keyOf(cell.r, cell.c)]: mark }, lastE: keyOf(cell.r, cell.c),
        phase: over || !sub ? cur.phase : 'q', q: over || !sub ? cur.q : randomQ(sub), msg: '', busy: false,
      }))
    }, 900)
  }

  const back = () => navigate('/')
  function goBack() {
    if (ph === 'mode') { back(); return }
    if (ph === 'friend' || ph === 'queue' || ph === 'unit') { setPh('mode'); return }
    if (ph === 'subunit') { setUnit(null); setPh('unit'); return }
    if (ph === 'place') { setSub(null); setPlaced([]); setPh('subunit'); return }
    setPh('mode')
  }

  const online = isFirebaseConfigured
  const signedIn = user !== null
  // Online play needs a VERIFIED email (see lib/social.ts): a signed-in but
  // unverified user would only hit permission-denied, so the online modes stay
  // disabled and we nudge them to verify instead. VS AI is always available.
  const needsVerify = online && signedIn && !emailVerified
  const onlineReady = online && signedIn && emailVerified

  // ================= RENDER =================
  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={goBack} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="font-pixel text-[12px]" style={{ color: CY }}>BATTLESHIP</div>
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>

        {ph === 'mode' && (
          <Section title="CHOOSE YOUR OPPONENT">
            {onlineError && <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{onlineError}</p>}
            <div className="grid gap-3">
              <ModeButton color={CY} title="VS AI" desc="Battle the computer — answer questions to earn your shots."
                onClick={() => setPh('unit')} />
              <ModeButton color="#ff3df0" title="VS FRIEND" desc="Challenge a friend to a live head-to-head battle."
                disabled={!onlineReady} onClick={() => setPh('friend')} />
              <ModeButton color="#3dffa2" title="QUICK MATCH" desc="Get paired with another player who's looking for a battle."
                disabled={!onlineReady} onClick={() => setPh('queue')} />
            </div>
            {!online && (
              <p className="text-center text-sm text-white/65 mt-4">Online play is unavailable in this build.</p>
            )}
            {online && !signedIn && !authLoading && (
              <p className="text-center text-sm text-white/65 mt-4">
                Sign in from the <Link to="/" className="text-neon-cyan underline underline-offset-4">lobby</Link> to battle friends and strangers online.
              </p>
            )}
            {needsVerify && (
              <VerifyEmailNotice
                className="mt-4 flex flex-col items-center text-center"
                message="Verify your email to play online."
              />
            )}
          </Section>
        )}

        {ph === 'friend' && (
          <Section title="CHALLENGE A FRIEND">
            {onlineError && <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{onlineError}</p>}
            {friends === null && !onlineError && (
              <p className="text-center text-white/70 font-pixel text-[10px] py-10">LOADING FRIENDS…</p>
            )}
            {friends !== null && friends.length === 0 && (
              <div className="text-center py-8">
                <p className="text-white/65 mb-4">No friends yet — add some by email first.</p>
                <Link to="/friends" className="arcade-btn inline-block font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620]" style={CY_BTN}>OPEN FRIENDS</Link>
              </div>
            )}
            {friends !== null && friends.length > 0 && user && (
              <ul className="grid gap-3">
                {friends.map((f) => {
                  const idx = f.uids[0] === user.uid ? 1 : 0
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <span className="text-sm text-white/90 truncate">{f.emails[idx]}</span>
                      <button onClick={() => void inviteFriend(f)} disabled={invitingUid !== null}
                        className="arcade-btn shrink-0 font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60"
                        style={CY_BTN}>
                        {invitingUid === f.uids[idx] ? 'INVITING…' : 'INVITE'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        )}

        {ph === 'queue' && (
          <Section title="QUICK MATCH">
            <div className="text-center py-10">
              <p className="font-pixel text-[11px] text-neon-green mb-3" aria-live="polite">
                <span className="blink-attract">SEARCHING FOR AN OPPONENT…</span>
              </p>
              <p className="text-sm text-white/65 mb-6">You'll be dropped into the battle as soon as someone joins.</p>
              <Btn onClick={() => setPh('mode')}>CANCEL</Btn>
            </div>
          </Section>
        )}

        {ph === 'unit' && !course && (
          <p className="text-center text-white/70 font-pixel text-[10px] py-16">LOADING COURSE…</p>
        )}

        {ph === 'unit' && course && (
          <Section title="CHOOSE A UNIT">
            <div className="grid gap-3 sm:grid-cols-2">
              {course.units.map((u) => (
                <button key={u.id} onClick={() => { setUnit(u); setPh('subunit') }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-neon-cyan/60 transition">
                  <div className="font-bold">{u.name}</div>
                  <div className="text-xs text-white/60 mt-1">{u.subunits.length} topics</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {ph === 'subunit' && unit && (
          <Section title={`${unit.name.toUpperCase()} — PICK A TOPIC`}>
            <div className="grid gap-3 sm:grid-cols-2">
              {unit.subunits.map((s) => (
                <button key={s.id} onClick={() => { setSub(s); setPlaced(randomFleet()); setPh('place') }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-neon-cyan/60 transition">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{s.name}</span>
                    <DiffBadge d={s.difficulty} />
                  </div>
                  <div className="text-xs text-white/60 mt-1 uppercase tracking-wide">{s.type} · vs AI</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {ph === 'place' && (
          <Section title="DEPLOY YOUR FLEET">
            <FleetPlacement placed={placed} onChange={setPlaced}
              actions={
                <button onClick={startBattle}
                  className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620]"
                  style={CY_BTN}>
                  START BATTLE
                </button>
              } />
          </Section>
        )}

        {ph === 'battle' && battle && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <FleetPips ships={battle.enemy} color="#ff4d8d" label={`ENEMY ${remaining(battle.enemy)}`} />
              <FleetPips ships={battle.placed} color={CY} label={`FLEET ${remaining(battle.placed)}`} align="right" />
            </div>

            <div className="text-center mb-2">
              <div className="font-pixel text-[10px] text-white/60">ENEMY WATERS</div>
            </div>
            <div className="flex justify-center mb-4">
              <BattleGrid ships={battle.enemy} shots={battle.pShots} showShips={false} lastShot={battle.lastP}
                disabled={battle.phase !== 'aim' || battle.busy} onCell={fireAtEnemy} />
            </div>

            <div className="h-6 text-center font-pixel text-[11px] mb-2" style={{ color: CY }} aria-live="polite">{battle.msg}</div>

            {battle.phase === 'q' && !battle.busy
              ? <QuestionPanel q={battle.q} color={CY} onSubmit={onAnswer} />
              : battle.phase === 'aim'
                ? <p className="flex items-center justify-center gap-2 text-white/70 text-sm mb-4"><Target width={16} height={16} className="text-neon-cyan" />Tap the enemy waters to fire!</p>
                : <p className="text-center text-white/60 text-sm mb-4">Enemy is firing…</p>}

            <div className="mt-5">
              <div className="text-center font-pixel text-[9px] text-white/60 mb-1">YOUR FLEET</div>
              <div className="flex justify-center">
                <BattleGrid ships={battle.placed} shots={battle.eShots} showShips disabled small lastShot={battle.lastE} />
              </div>
            </div>
          </div>
        )}

        {ph === 'over' && (
          <div className="text-center py-12">
            <div className="font-pixel text-2xl mb-4" style={{ color: winner === 'you' ? '#3dffa2' : '#ff4d8d' }}>
              {winner === 'you' ? 'VICTORY!' : 'DEFEATED'}
            </div>
            <p className="text-white/50 mb-6">{winner === 'you' ? 'You sank the enemy fleet.' : 'Your fleet was sunk.'}</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => { setPlaced(randomFleet()); setBattle(null); setWinner(null); setRewarded(false); setPh('place') }}
                className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={CY_BTN}>PLAY AGAIN</button>
              <button onClick={back} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">ARCADE</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ModeButton({ color, title, desc, onClick, disabled }: {
  color: string; title: string; desc: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-5 transition enabled:hover:bg-white/[0.06] disabled:opacity-45 disabled:cursor-default"
      style={{ borderColor: disabled ? undefined : `${color}55` }}>
      <div className="font-pixel text-[11px] mb-1.5" style={{ color }}>{title}</div>
      <div className="text-sm text-white/65">{desc}</div>
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-pixel text-[11px] tracking-wider text-neon-cyan neon-text mb-5 text-center">{title}</h2>{children}</div>
}
function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 transition-all hover:bg-white/10 hover:border-neon-cyan/40 active:scale-95">{children}</button>
}
function DiffBadge({ d }: { d: 'easy' | 'medium' | 'hard' }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[9px] font-pixel px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
