import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSE_LIST, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { loadCourse } from '../lib/content'
import { usePlayer, resolveCourseId, levelFromXp } from '../lib/player'
import { useCardGame, type CardGameConfig } from '../hooks/useCardGame'

type Game = ReturnType<typeof useCardGame>
import type { Color } from '../lib/cardgame'
import { colorName, placementFor } from '../lib/cardgameView'
import { StaticCard } from '../components/CardFace'
import CardTable3D from '../components/CardTable3D'
import { isReducedMotion } from '../lib/motion'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { summarize, taggedPool, type AnsweredItem, type TaggedQuestion } from '../lib/summary'
import { ArrowLeft, Volume, VolumeMute, Coin, Bolt, Replay, Star, Cards } from '../icons'
import { sfxPick, sfxDeny, sfxWin, setMuted, isMuted } from '../lib/sound'

const ACCENT = '#7c3aff' // neon violet — the Card Game cabinet's accent
const PLAYER_COUNT = 4 // player 0 is you; 1–3 are AI
const AI_NAMES = ['NOVA', 'VEGA', 'ORION'] as const
const MAX_TOPICS = 6

// ECLIPSE suit swatches (mirrors SUIT in CardTable3D): engine colors remap to
// Ember/Solar/Forest/Lunar. Solar's cream button takes dark ink for AA.
const SUIT_UI: Record<Color, { hex: string; ink: string }> = {
  red: { hex: '#b8412f', ink: '#ffffff' },
  yellow: { hex: '#e9dcba', ink: '#26190e' },
  green: { hex: '#4e7a48', ink: '#ffffff' },
  blue: { hex: '#3c5c94', ink: '#ffffff' },
}
const subKey = (unitId: string, subId: string) => `${unitId}/${subId}`

/** Combined reduced-motion preference: OS setting OR the in-app Settings toggle. */
function prefersReducedMotion(): boolean {
  if (isReducedMotion()) return true
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// Weight selected topics by their question count to size the AI field, snapping
// the average back to a band (mirrors Racer's aggregateDifficulty).
function aggregateDifficulty(subs: Subunit[]): Difficulty {
  const rank: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 }
  let total = 0
  let weight = 0
  for (const s of subs) { total += rank[s.difficulty] * s.questions.length; weight += s.questions.length }
  if (weight === 0) return 'medium'
  const avg = total / weight
  return avg <= 0.5 ? 'easy' : avg >= 1.5 ? 'hard' : 'medium'
}

// Split the selected questions into the two tiers the engine asks for. A card's
// requiredDifficulty is 'easy' (numbers) or 'hard' (actions/wilds); medium topics
// back the easy tier. Either tier falls back to the whole set so it's never empty.
function buildPools(subs: Subunit[]): { easy: TaggedQuestion[]; hard: TaggedQuestion[] } {
  const all = taggedPool(subs)
  const easy = taggedPool(subs.filter((s) => s.difficulty !== 'hard'))
  const hard = taggedPool(subs.filter((s) => s.difficulty === 'hard'))
  return { easy: easy.length ? easy : all, hard: hard.length ? hard : all }
}

type Screen = 'course' | 'build' | 'play'

export default function CardGame() {
  const navigate = useNavigate()
  const { player, finishGame, recordAnswer } = usePlayer()
  const preferredCourseId = resolveCourseId(player.preferredCourseId)

  const [screen, setScreen] = useState<Screen>('course')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [muted, setMutedState] = useState(isMuted())
  // Session-scoped answers, tagged by subtopic — feeds the end-of-game summary.
  const [answers, setAnswers] = useState<AnsweredItem[]>([])

  const view = useCardGame({
    finishGame,
    recordAnswer,
    onAnswered: (item: TaggedQuestion, correct: boolean) =>
      setAnswers((a) => [...a, { subunitId: item.subunitId, subunitName: item.subunitName, correct }]),
    onCorrect: sfxPick,
    onWrong: sfxDeny,
    onWin: sfxWin,
  })

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    setCourse(null)
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [courseId])

  const selectedSubs: Subunit[] = useMemo(() => course
    ? course.units.flatMap((u) => u.subunits.filter((s) => selected.has(subKey(u.id, s.id))))
    : [], [course, selected])
  const questionCount = selectedSubs.reduce((n, s) => n + s.questions.length, 0)
  const canStart = selectedSubs.length > 0 && questionCount > 0

  function toggleSub(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else { if (next.size >= MAX_TOPICS) return prev; next.add(key) }
      return next
    })
  }

  function start() {
    if (!canStart) return
    const config: CardGameConfig = {
      playerCount: PLAYER_COUNT,
      difficulty: aggregateDifficulty(selectedSubs),
      aiNames: [...AI_NAMES],
      pools: buildPools(selectedSubs),
    }
    view.actions.begin(config)
    setScreen('play')
  }

  function goBack() {
    if (screen === 'course') { navigate('/'); return }
    if (screen === 'build') { setScreen('course'); return }
    setScreen('build') // leave a game in progress back to setup
  }

  const showResults = screen === 'play' && view.phase === 'gameover' && view.result

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={goBack} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="flex items-center gap-2 font-sans font-bold text-sm tracking-[0.14em]" style={{ color: '#c9b3ff' }}><Cards width={18} height={18} /> CARD GAME</div>
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>

        {screen === 'course' && (
          <Section title="CHOOSE A COURSE">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id} onClick={() => { setCourseId(c.id); setSelected(new Set()); setScreen('build') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className={`text-left rounded-xl border bg-white/[0.03] p-4 transition ${preferred ? 'border-neon-violet/70' : 'border-white/10 hover:border-neon-violet/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{c.name}</span>
                      {preferred && <span className="shrink-0 font-sans text-[10px] font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${ACCENT}33`, color: '#c9b3ff' }}>YOUR LEVEL</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {screen === 'build' && !course && (
          <p className="text-center text-white/70 font-sans text-sm py-16">Loading course…</p>
        )}

        {screen === 'build' && course && (
          <Section title="PICK YOUR TOPICS">
            <p className="text-center text-sm text-white/60 mb-5">
              Load up to {MAX_TOPICS} topics. Number cards ask an easy question; action &amp; wild cards ask a hard one.
            </p>
            <div className="flex items-center justify-between mb-4 rounded-lg bg-white/[0.03] border border-white/10 px-4 py-2.5">
              <span className="font-sans text-xs font-semibold tracking-wide text-white/80">{selected.size}/{MAX_TOPICS} topics · {questionCount} questions</span>
              <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
                className="font-sans text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">Clear</button>
            </div>
            {course.units.every((u) => u.subunits.every((s) => s.questions.length === 0)) ? (
              <p className="text-center text-sm text-white/60 py-8">This course has no authored questions yet — pick another course.</p>
            ) : (
              <div className="grid gap-5">
                {course.units.filter((u) => u.subunits.length > 0).map((u) => (
                  <div key={u.id}>
                    <div className="font-bold text-white/90 mb-2">{u.name}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {u.subunits.map((s) => {
                        const key = subKey(u.id, s.id)
                        const checked = selected.has(key)
                        const noQ = s.questions.length === 0
                        const blocked = !checked && selected.size >= MAX_TOPICS
                        const disabled = noQ || blocked
                        return (
                          <button key={s.id} role="checkbox" aria-checked={checked} aria-disabled={disabled}
                            onClick={() => { if (!disabled) toggleSub(key) }}
                            className={`flex items-center gap-3 text-left rounded-lg border p-3 transition ${disabled ? 'opacity-45 cursor-default border-white/10' : 'hover:border-neon-violet/50 border-white/10'}`}
                            style={checked ? { borderColor: ACCENT, background: `${ACCENT}1f` } : undefined}>
                            <span aria-hidden className="grid place-items-center w-5 h-5 rounded border shrink-0"
                              style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.4)', background: checked ? ACCENT : 'transparent' }}>
                              {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#150c30" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-semibold truncate">{s.name}</span>
                                <DiffBadge d={s.difficulty} />
                              </span>
                              <span className="block text-xs text-white/55 mt-0.5">{noQ ? 'No questions yet' : `${s.questions.length} questions`}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-7 flex flex-col items-center gap-2">
              <button onClick={start} disabled={!canStart}
                className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-white disabled:opacity-40 transition"
                style={{ background: ACCENT, boxShadow: canStart ? `0 6px 20px -6px ${ACCENT}` : 'none' }}>
                Deal cards
              </button>
              {!canStart && <span className="text-xs text-white/60">Select at least one topic to start.</span>}
            </div>
          </Section>
        )}

        {screen === 'play' && !showResults && (
          <div>
            <CardTable3D view={view} accent={ACCENT} reduced={prefersReducedMotion()} onCardActivate={(card) => {
              if (view.phase === 'choose') view.actions.selectCard(card)
              else if (view.phase === 'penalty') view.actions.selectStack(card)
            }} />
            <div className="mt-4">
              <ActionPanel view={view} />
            </div>
            <p className="sr-only" aria-live="polite">{view.log}</p>
            <div className="mt-3 text-center text-[12px] text-white/60" aria-hidden>{view.log}</div>
          </div>
        )}

        {showResults && view.result && (
          <Results
            view={view}
            answers={answers}
            level={levelFromXp(player.xp).level}
            onAgain={() => view.actions.replay()}
            onPick={() => setScreen('build')}
            onHome={() => navigate('/')}
          />
        )}
      </div>
    </div>
  )
}

// The phase-specific control surface: question, color pick, penalty choice, or
// the drawn-card play. Kept beside the flow (it drives the hook actions); the
// visual table above is what the 3D stage swaps.
function ActionPanel({ view }: { view: Game }) {
  const { phase, actions } = view
  if (phase === 'question' && view.question) {
    return <QuestionPanel q={view.question.q} color={ACCENT} onSubmit={actions.answer} label={view.questionLabel} surface="plain" />
  }
  if (phase === 'color' && view.activeCard) {
    return (
      <Panel>
        <p className="text-center font-sans font-semibold text-sm text-white/85 mb-4">Choose a color for your wild</p>
        <ColorPicker onPick={actions.chooseColor} />
      </Panel>
    )
  }
  if (phase === 'penalty') {
    const canStack = view.stackable.length > 0
    return (
      <Panel>
        <p className="text-center text-sm text-white/80 mb-1">
          You&apos;re hit with <span className="font-bold" style={{ color: ACCENT }}>+{view.pendingDraw}</span>.
        </p>
        <p className="text-center text-xs text-white/55 mb-4">
          {canStack ? 'Stack a matching card above to pass it on (a hard question), or take the cards.' : 'No card to stack — take the cards.'}
        </p>
        <div className="flex justify-center">
          <button onClick={actions.takePenalty}
            className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white" style={{ background: '#5a3a86' }}>
            Take +{view.pendingDraw}
          </button>
        </div>
      </Panel>
    )
  }
  if (phase === 'drawn' && view.activeCard) {
    const card = view.activeCard
    const isWild = card.kind === 'wild' || card.kind === 'wild4'
    return (
      <Panel>
        <div className="flex items-center justify-center gap-3 mb-4">
          <StaticCard card={card} size="md" />
          <p className="text-sm text-white/80">You drew a playable card — solve a question to play it, or keep it.</p>
        </div>
        {isWild && <p className="text-center font-sans font-semibold text-sm text-white/80 mb-3">Choose a color to play it</p>}
        <div className="flex flex-col items-center gap-3">
          {isWild ? (
            <ColorPicker onPick={(c) => actions.playDrawn(c)} />
          ) : (
            <button onClick={() => actions.playDrawn()}
              className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white" style={{ background: ACCENT }}>
              Solve to play it
            </button>
          )}
          <button onClick={actions.keepDrawn}
            className="font-sans font-semibold text-sm px-6 py-3 rounded-lg bg-white/5 border border-white/15 text-white/85 hover:bg-white/10 transition">
            Keep it
          </button>
        </div>
      </Panel>
    )
  }
  if (phase === 'choose' && view.legal.length === 0) {
    return (
      <Panel>
        <p className="text-center text-sm text-white/70 mb-4">No playable card — draw one.</p>
        <div className="flex justify-center">
          <button onClick={actions.requestDraw}
            className="font-sans font-bold text-sm px-6 py-3 rounded-lg text-white" style={{ background: ACCENT }}>
            Draw a card
          </button>
        </div>
      </Panel>
    )
  }
  if (phase === 'choose') {
    return <p className="text-center text-sm text-white/60 py-3">Tap a highlighted card to play it.</p>
  }
  // AI thinking
  return <p className="text-center text-sm text-white/45 py-3">Opponents are playing…</p>
}

function ColorPicker({ onPick }: { onPick: (c: Color) => void }) {
  const colors: Color[] = ['red', 'yellow', 'green', 'blue']
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {colors.map((c) => (
        <button key={c} onClick={() => onPick(c)} aria-label={`Choose ${colorName(c)}`}
          className="flex items-center justify-center gap-2 py-3 rounded-lg font-sans font-bold text-sm tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: SUIT_UI[c].hex, color: SUIT_UI[c].ink, border: '1px solid rgba(201,163,92,0.6)', boxShadow: `0 4px 14px -4px ${SUIT_UI[c].hex}` }}>
          <span aria-hidden className="w-3 h-3 rotate-45 rounded-[2px]" style={{ background: SUIT_UI[c].ink, opacity: 0.85 }} />
          {colorName(c).toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function Results({ view, answers, level, onAgain, onPick, onHome }: {
  view: Game; answers: readonly AnsweredItem[]; level: number
  onAgain: () => void; onPick: () => void; onHome: () => void
}) {
  const r = view.result!
  const won = r.placement === 1
  const ord = ['', '1ST', '2ND', '3RD', '4TH', '5TH'][r.placement] ?? `${r.placement}TH`
  // Final standings: you + every AI, ranked by cards left (fewest first). Places
  // (with ties) come from the same pure helper the score uses.
  const players = [
    { name: 'YOU', count: view.hand.length, you: true },
    ...view.seats.map((s) => ({ name: s.name, count: s.count, you: false })),
  ]
  const counts = players.map((p) => p.count)
  const ranked = players
    .map((p, i) => ({ ...p, place: placementFor(counts, i) }))
    .sort((a, b) => a.count - b.count)
  return (
    <div className="text-center py-6">
      <div className="font-sans font-extrabold text-3xl tracking-tight mb-2" style={{ color: won ? '#3dffa2' : '#c9b3ff' }}>
        {won ? 'You win!' : `${ord} place`}
      </div>
      <p className="text-white/60 text-sm mb-6">
        {won ? 'You emptied your hand first.' : `You finished with ${view.hand.length} card${view.hand.length === 1 ? '' : 's'} in hand.`}
      </p>

      <div className="max-w-xs mx-auto rounded-xl border border-white/10 bg-white/[0.03] divide-y divide-white/8 mb-6">
        {ranked.map((p) => (
          <Row key={p.name} place={p.place} you={p.you} label={p.you ? 'YOU' : p.name} count={p.count} />
        ))}
      </div>

      <div className="text-left max-w-sm mx-auto mb-6">
        <SessionSummary summary={summarize(answers)} color={ACCENT} />
      </div>

      <div className="flex justify-center gap-3 mb-2">
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-neon-amber font-bold"><Coin width={18} height={18} /> +{r.rewards.coins}</span>
        <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 font-bold" style={{ color: '#c9b3ff' }}><Bolt width={18} height={18} /> +{r.rewards.xp} XP</span>
      </div>
      {r.rewards.best && <div className="inline-flex items-center gap-1 font-sans font-bold text-[11px] tracking-wide px-2.5 py-1 rounded bg-neon-amber text-[#2a1a00] mb-2"><Star width={12} height={12} /> NEW BEST</div>}
      <div className="text-xs text-white/50 mb-6">Level {level}</div>

      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={onAgain} className="flex items-center gap-2 font-sans font-bold text-sm px-5 py-3 rounded-lg text-white" style={{ background: ACCENT }}>
          <Replay width={16} height={16} /> Play again
        </button>
        <button onClick={onPick} className="font-sans font-semibold text-sm px-5 py-3 rounded-lg bg-white/5 border border-white/15 text-white/85 hover:bg-white/10 transition">New topics</button>
        <button onClick={onHome} className="font-sans font-semibold text-sm px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition">Arcade</button>
      </div>
    </div>
  )
}

function Row({ place, you, label, count }: { place: number; you: boolean; label: string; count: number }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 text-sm ${you ? 'text-white font-bold' : 'text-white/75'}`}>
      <span className="font-sans font-bold text-[11px] w-8 text-left tabular-nums" style={{ color: place === 1 ? '#3dffa2' : '#ffffff70' }}>P{place}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      <span className="tabular-nums text-white/60 text-xs">{count} left</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-sans font-bold text-sm tracking-[0.18em] mb-5 text-center" style={{ color: '#c9b3ff' }}>{title}</h2>{children}</div>
}
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">{children}</div>
}
function DiffBadge({ d }: { d: Difficulty }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[10px] font-sans font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
