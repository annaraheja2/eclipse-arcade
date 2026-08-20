// The Card Game, played with friends — and with hands nobody else can read.
//
// Nobody deals. The room's seed splits the deck into a piece per seat, the same
// way on every screen, and each player shuffles their own piece with a secret
// only they hold (lib/cardRoom.ts). So a hand is never held by another player,
// not even for the instant it takes to deal one.
//
// The shared document carries the face-up pile, whose turn it is, and how many
// cards everybody holds — and nothing else. Your own cards live in a document
// the rules let only you read.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { usePlayer, levelFromXp } from '../lib/player'
import { loadCourse } from '../lib/content'
import { isFirebaseConfigured } from '../lib/firebase'
import type { Course, Question, Subunit } from '../data/subjects'
import {
  subscribeGameRoom, inviteToGameRoom, joinGameRoom, leaveGameRoom, startGameRoom,
  commitGameTransition, deleteGameRoom, writeMyHand, subscribeMyHand, type GameRoom,
} from '../lib/gameroom'
import {
  openingPublic, dealMine, isMyTurn, myLegalPlays, playFromHand, stackOrTakePenalty,
  drawOne, passAfterDraw, toCardPublic, toCardHand, cardPublicData, cardHandData,
  type CardPublic, type CardHand,
} from '../lib/cardRoom'
import { COLORS, type Card, type Color } from '../lib/cardgame'
// Chairs and opening state come from the one registry every seating surface
// reads, so the JOIN button here and an accepted invite agree.
import { tableRules } from '../lib/gameTables'
import { colorName } from '../lib/cardgameView'
import { randomSecret } from '../lib/fairseed'
import { questionIndexFor } from '../lib/lsroom'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor, seatName } from '../lib/username'
import TableLobby from '../components/TableLobby'
import { StaticCard } from '../components/CardFace'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, type AnsweredItem } from '../lib/summary'
import { sfxPick, sfxDeny, sfxWin } from '../lib/sound'
import { ArrowLeft, Coin, Bolt, Star } from '../icons'

const ACCENT = '#7c3aff'
const TABLE = tableRules('cardgame')
const SEAT_TINT = ['#7c3aff', '#ff4d8d', '#3dffa2', '#ffb43d', '#3df5ff'] as const

/**
 * My shuffle secret, kept for the life of the table. Persisting it means an
 * ordinary refresh re-deals me the SAME hand rather than a fresh one — without
 * it, reloading would be a free re-roll.
 */
function secretFor(roomId: string): string {
  const key = `eclipse-arcade:cardsecret:${roomId}`
  try {
    const kept = localStorage.getItem(key)
    if (kept) return kept
    const made = randomSecret()
    localStorage.setItem(key, made)
    return made
  } catch {
    // Private browsing with storage blocked: a per-load secret still deals a
    // valid hand, it just won't survive a refresh.
    return randomSecret()
  }
}

type Pending =
  | { kind: 'none' }
  | { kind: 'color'; card: Card; then: 'play' | 'stack' }
  | { kind: 'question'; card: Card | null; color?: Color; then: 'play' | 'stack' }

export default function CardGameOnline() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, emailVerified } = useAuth()
  const { player, finishGame, recordAnswer } = usePlayer()
  const uid = user?.uid ?? null

  const [room, setRoom] = useState<GameRoom | null>(null)
  const [missing, setMissing] = useState(false)
  const [course, setCourse] = useState<Course | null>(null)
  const [mine, setMine] = useState<CardHand | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const [log, setLog] = useState('')
  const [reward, setReward] = useState<{ xp: number; coins: number; best: boolean } | null>(null)
  const [answers, setAnswers] = useState<AnsweredItem[]>([])
  const [dealt, setDealt] = useState(false)
  const [rewarded, setRewarded] = useState(false)

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
    return subscribeMyHand<CardHand>(roomId, uid, toCardHand, setMine,
      (err) => console.error('[eclipse-arcade] hand feed failed:', err))
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
  const pub: CardPublic | null = useMemo(() => (room ? toCardPublic(room.state) : null), [room])

  const subunit: Subunit | null = useMemo(() => {
    if (!course || !room) return null
    const unit = course.units.find((u) => u.id === room.sel.unitId)
    return unit?.subunits.find((s) => s.id === room.sel.subunitId) ?? null
  }, [course, room])
  const poolQs = subunit?.questions ?? []
  const question: Question | null = poolQs.length > 0 && room
    ? poolQs[questionIndexFor(room.seed, room.tick, poolQs.length)]
    : null

  // Deal myself in, once, when the table starts. Nobody deals for me.
  useEffect(() => {
    if (!room || !uid || !seated || dealt) return
    if (room.status !== 'active' || mine) return
    setDealt(true)
    const hand = dealMine(room.seed, room.members.length, mySeat, secretFor(room.id))
    void writeMyHand(room.id, uid, cardHandData(hand))
      .catch((err) => {
        console.error('[eclipse-arcade] could not take my cards:', err)
        setError('Could not pick up your hand — reload to try again.')
        setDealt(false)
      })
  }, [room, uid, seated, mine, dealt, mySeat])

  const names = useUsernames(
    room ? [...room.members, ...room.invited, ...(uid ? [uid] : [])] : [],
  )
  const nameOf = useCallback(
    (u: string) => room?.names[u] ?? displayNameFor(names[u], null),
    [room, names],
  )

  useEffect(() => {
    if (!pub || pub.winner === null || !seated || rewarded) return
    setRewarded(true)
    const won = pub.winner === mySeat
    if (won) sfxWin()
    // Same shape the solo game scores on: emptying your hand is the win.
    setReward(finishGame('cardgame', won ? 3000 : Math.max(0, 1200 - (pub.counts[mySeat] ?? 0) * 100)))
  }, [pub, seated, mySeat, rewarded, finishGame])

  async function guard(action: () => Promise<unknown>, failure: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action() } catch (err) {
      console.error('[eclipse-arcade] table action failed:', err)
      setError(err instanceof Error ? err.message : failure)
    } finally { setBusy(false) }
  }

  /** Writes a resolved turn: my hand to my own document, the rest to the room. */
  async function commit(nextPub: CardPublic, nextMine: CardHand) {
    if (!room || !uid) return
    await writeMyHand(room.id, uid, cardHandData(nextMine))
    const landed = await commitGameTransition(
      room.id, room.tick, cardPublicData(nextPub), nextPub.winner !== null,
    )
    if (!landed) setError('Somebody else moved first — the table has moved on.')
  }

  const legal = pub && mine && seated ? myLegalPlays(pub, mine, mySeat) : []
  const legalIds = new Set(legal.map((c) => c.id))
  const myTurn = !!pub && seated && isMyTurn(pub, mySeat)
  const owed = pub?.pendingDraw ?? 0

  function chooseCard(card: Card) {
    if (!myTurn || busy) return
    const wild = card.kind === 'wild' || card.kind === 'wild4'
    const then = owed > 0 ? 'stack' : 'play'
    if (wild) setPending({ kind: 'color', card, then })
    else setPending({ kind: 'question', card, then })
  }

  function answer(correct: boolean) {
    if (!pub || !mine || pending.kind !== 'question') return
    recordAnswer(correct)
    if (subunit) {
      setAnswers((a) => [...a, { subunitId: subunit.id, subunitName: subunit.name, correct }])
    }
    if (correct) sfxPick(); else sfxDeny()
    const { card, color, then } = pending
    const res = then === 'stack'
      ? stackOrTakePenalty(pub, mine, mySeat, card, correct, color)
      : playFromHand(pub, mine, mySeat, card!, correct, color)
    setPending({ kind: 'none' })
    if (res.outcome === 'illegal') { setError('That move is no longer legal.'); return }
    setLog(correct ? 'Played.' : 'Wrong — the play is forfeited.')
    void guard(() => commit(res.pub, res.mine), 'Could not send your move.')
  }

  function draw() {
    if (!pub || !mine || !myTurn || busy) return
    const res = drawOne(pub, mine, mySeat, Math.random)
    if (res.outcome === 'illegal') return
    setLog(res.outcome === 'drew-playable' ? 'You drew something you can play.' : 'You drew and passed.')
    void guard(() => commit(res.pub, res.mine), 'Could not draw.')
  }

  function take() {
    if (!pub || !mine || !myTurn || busy) return
    const res = stackOrTakePenalty(pub, mine, mySeat, null, true)
    if (res.outcome === 'illegal') return
    setLog(`You took ${owed}.`)
    void guard(() => commit(res.pub, res.mine), 'Could not take the cards.')
  }

  function pass() {
    if (!pub || !mine || !myTurn || busy) return
    const res = passAfterDraw(pub, mine, mySeat)
    void guard(() => commit(res.pub, res.mine), 'Could not pass.')
  }

  // ---- gates --------------------------------------------------------------
  if (!isFirebaseConfigured) return <Shell><Notice>Online play needs the arcade's cloud setup, which isn't configured here.</Notice></Shell>
  if (authLoading) return <Shell><Notice>Loading…</Notice></Shell>
  if (!user) return <Shell><Notice>Sign in to play with friends.</Notice></Shell>
  if (!emailVerified) return <Shell><Notice>Verify your email before joining a table.</Notice></Shell>
  if (missing) return <Shell><Notice>That table is no longer available.</Notice></Shell>
  if (!room) return <Shell><Notice>Finding the table…</Notice></Shell>

  const iAmHost = room.host === uid

  return (
    <Shell onBack={() => navigate('/cardgame')}>
      {error && <p role="alert" className="text-center text-sm text-[#ff9dbd] mb-4">{error}</p>}

      {room.status === 'lobby' && (
        <TableLobby
          room={room} uid={uid!} iAmHost={iAmHost} seated={seated} busy={busy}
          maxSeats={TABLE.maxSeats} accent={ACCENT} heading="THE TABLE"
          blurb={subunit
            ? <>Everyone answers <span className="text-white/90">{subunit.name}</span>. Solve to play a card — first to empty their hand wins. Nobody deals: you shuffle your own cards.</>
            : 'Loading the topic…'}
          nameOf={nameOf}
          onInvite={(f) => void guard(() => inviteToGameRoom(room.id, f), 'Could not send that invite.')}
          onJoin={() => void guard(
            () => joinGameRoom(room.id, { uid: uid!, name: seatName(names[uid!], user.email) },
              TABLE.maxSeats, TABLE.seatState),
            'Could not take a seat.',
          )}
          onStart={() => void guard(async () => {
            // The opening state is sized to whoever actually sat down.
            await commitGameTransition(room.id, room.tick,
              cardPublicData(openingPublic(room.seed, room.members.length)), false)
            await startGameRoom(room.id, uid!)
          }, 'Could not start the game.')}
          onLeave={() => void guard(async () => {
            await leaveGameRoom(room.id, uid!, TABLE.maxSeats, TABLE.seatState)
            navigate('/cardgame')
          }, 'Could not leave the table.')}
        />
      )}

      {room.status !== 'lobby' && pub && (
        <div>
          {/* The face-up pile and the active colour. */}
          <div className="flex items-center justify-center gap-5 mb-4">
            <StaticCard card={pub.discardTop} size="lg" chosenColor={pub.currentColor} />
            <div className="text-left">
              <p className="font-pixel text-[9px] text-white/50">ACTIVE COLOUR</p>
              <p className="font-sans font-bold text-lg" style={{ color: tintOf(pub.currentColor) }}>
                {colorName(pub.currentColor)}
              </p>
              {owed > 0 && (
                <p className="mt-1 text-sm text-[#ff9dbd]">{owed} to draw</p>
              )}
            </div>
          </div>

          {/* Everyone at the table, and how much they're holding. */}
          <ul className="grid gap-2 mb-4">
            {seats.map((u, seat) => (
              <li key={u ?? seat}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${pub.turn === seat && pub.winner === null ? 'border-white/30 bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
                <span className="truncate text-white/90">
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: SEAT_TINT[seat % SEAT_TINT.length] }} />
                  {u ? nameOf(u) : 'Empty seat'}
                  {u === uid && <span className="ml-2 text-xs text-white/45">you</span>}
                  {pub.winner === seat && <span className="ml-2 font-pixel text-[8px]" style={{ color: ACCENT }}>WINNER</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-white/60">
                  {pub.counts[seat] ?? 0} card{(pub.counts[seat] ?? 0) === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>

          {log && <p className="text-center text-xs text-white/50 mb-3">{log}</p>}

          {pub.winner !== null ? (
            <Finished
              won={pub.winner === mySeat}
              winner={nameOf(seats[pub.winner] ?? '')}
              reward={reward} level={levelFromXp(player.xp).level}
              answers={answers} iAmHost={iAmHost}
              onClose={() => void guard(async () => {
                if (iAmHost) await deleteGameRoom(room.id)
                navigate('/cardgame')
              }, 'Could not close the table.')}
            />
          ) : pending.kind === 'color' ? (
            <Panel title="PICK A COLOUR">
              <div className="flex flex-wrap justify-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setPending({ kind: 'question', card: pending.card, color: c, then: pending.then })}
                    className="font-sans font-bold text-sm px-4 py-2.5 rounded-lg text-[#0a0620]"
                    style={{ background: tintOf(c) }}>
                    {colorName(c)}
                  </button>
                ))}
              </div>
            </Panel>
          ) : pending.kind === 'question' ? (
            question
              ? <QuestionPanel q={question} color={ACCENT} onSubmit={answer} surface="plain" label="SOLVE TO PLAY" />
              : <Panel title="NO QUESTIONS"><p className="text-sm text-white/70 text-center">This topic has no questions right now.</p></Panel>
          ) : !seated ? (
            <p className="text-center text-sm text-white/70 py-6">Watching this table.</p>
          ) : !myTurn ? (
            <p className="text-center text-sm text-white/70 py-6">
              Waiting for <span className="font-semibold text-white">{nameOf(seats[pub.turn] ?? '')}</span>…
            </p>
          ) : !mine ? (
            <p className="text-center text-sm text-white/70 py-6">Picking up your cards…</p>
          ) : (
            <div>
              <p className="font-pixel text-[9px] text-white/50 mb-2">
                YOUR HAND {legal.length === 0 && owed === 0 && '· nothing playable, draw one'}
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {mine.hand.map((c) => {
                  const playable = legalIds.has(c.id)
                  return (
                    <button key={c.id} onClick={() => chooseCard(c)} disabled={!playable || busy}
                      aria-label={playable ? `Play ${c.kind}` : `${c.kind}, not playable`}
                      className={`rounded-xl transition ${playable ? 'hover:-translate-y-1 focus-visible:-translate-y-1' : 'opacity-40 cursor-default'}`}>
                      <StaticCard card={c} size="md" />
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {owed > 0 ? (
                  <button onClick={take} disabled={busy}
                    className="font-pixel text-[10px] px-4 py-2.5 rounded-lg text-[#0a0620]" style={{ background: ACCENT }}>
                    TAKE {owed}
                  </button>
                ) : (
                  <>
                    <button onClick={draw} disabled={busy}
                      className="font-pixel text-[10px] px-4 py-2.5 rounded-lg text-[#0a0620]" style={{ background: ACCENT }}>
                      DRAW ({mine.reserve.length})
                    </button>
                    <button onClick={pass} disabled={busy}
                      className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10">
                      PASS
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}

const TINT: Record<Color, string> = {
  red: '#ff6b5e', yellow: '#ffd15c', green: '#5ce08a', blue: '#5ca8ff',
}
const tintOf = (c: Color) => TINT[c]

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="font-pixel text-[9px] text-white/50 mb-3 text-center">{title}</p>
      {children}
    </div>
  )
}

function Finished({ won, winner, reward, level, answers, iAmHost, onClose }: {
  won: boolean; winner: string
  reward: { xp: number; coins: number; best: boolean } | null
  level: number; answers: readonly AnsweredItem[]; iAmHost: boolean; onClose: () => void
}) {
  return (
    <div className="mt-4 text-center">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: won ? '#c9b3ff' : '#ff9dbd' }}>
        {won ? 'You went out!' : `${winner} went out`}
      </div>
      {reward && (
        <>
          <div className="flex justify-center gap-3 my-4">
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold">
              <Coin width={18} height={18} /> +{reward.coins}
            </span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#c9b3ff' }}>
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
        className="font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={{ background: ACCENT }}>
        {iAmHost ? 'CLOSE TABLE' : 'BACK TO CARD GAME'}
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
          <button aria-label="Back" onClick={onBack ?? (() => navigate('/cardgame'))}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <div className="font-pixel text-[11px]" style={{ color: ACCENT }}>CARD GAME · TABLE</div>
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
