// Practice — the study tab (reached from the lobby HUD, like Settings/Friends).
// Not a cabinet: no clock, no score, no coins. A player picks a course, a unit,
// and the subtopics they want, then works through the questions admins authored
// for exactly those subtopics.
//
// Content comes from loadCourse, so this shows the /admin (Firestore) copy of a
// course merged over the bundle — the same questions the games ask.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSE_LIST, type Course, type Difficulty, type Subunit, type Unit } from '../data/subjects'
import { loadCourse } from '../lib/content'
import { poolFor, unitQuestionCount, startQueue, advance, current, answerText, type Queue, type PracticeItem } from '../lib/practice'
import { summarize, type AnsweredItem } from '../lib/summary'
import { instantiate } from '../lib/templates'
import { templatesFor, hasTemplate } from '../data/templates'
import QuestionPanel from '../components/QuestionPanel'
import SessionSummary from '../components/SessionSummary'
import { usePlayer, resolveCourseId, accuracy } from '../lib/player'
import { ArrowLeft, Book } from '../icons'

const ACCENT = '#a24bff'
// Thin glyphs in the accent need brightening to clear AA on the #0a0620 field;
// the accent itself is only ever a fill behind dark text or a border.
const ACCENT_TEXT = `color-mix(in srgb, ${ACCENT} 62%, #fff)`
const OK = '#3dffa2'
const MISS = '#ff9dbd'

type BtnVars = CSSProperties & { '--btn': string; '--edge': string; '--glow': string }
const BTN: BtnVars = { '--btn': ACCENT, '--edge': `color-mix(in srgb, ${ACCENT} 50%, #000)`, '--glow': `${ACCENT}88` }

// course -> unit -> subtopics -> the questions themselves -> how it went.
type Screen = 'course' | 'unit' | 'topics' | 'practice' | 'summary'

export default function Practice() {
  const navigate = useNavigate()
  const { player, recordAnswer } = usePlayer()
  const preferredCourseId = resolveCourseId(player.preferredCourseId)

  const [screen, setScreen] = useState<Screen>('course')
  const [courseId, setCourseId] = useState<string | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [queue, setQueue] = useState<Queue<PracticeItem> | null>(null)
  const [result, setResult] = useState<boolean | null>(null)
  const [graded, setGraded] = useState(false) // only the first try at a question counts
  const [attempt, setAttempt] = useState(0)   // bumped to remount QuestionPanel (clears its inputs)
  const [asked, setAsked] = useState(0)
  const [right, setRight] = useState(0)
  // First-try answers, tagged with their subtopic — the end-of-session summary
  // groups by these. Session-scoped: never persisted.
  const [answers, setAnswers] = useState<AnsweredItem[]>([])

  // loadCourse always resolves — it falls back to the bundled course.
  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    setCourse(null)
    void loadCourse(courseId).then((c) => { if (!cancelled) setCourse(c) })
    return () => { cancelled = true }
  }, [courseId])

  const unit: Unit | null = useMemo(
    () => (course && unitId ? course.units.find((u) => u.id === unitId) ?? null : null),
    [course, unitId],
  )
  const pool = useMemo(
    () => (course && unitId ? poolFor(course, unitId, selected) : []),
    [course, unitId, selected],
  )
  // A question built from this subtopic's template, shown in place of the queue's
  // until the player moves on. The queue itself is untouched, so "next" still
  // works through the authored questions in order.
  const [generated, setGenerated] = useState<PracticeItem | null>(null)

  const item = generated ?? (queue ? current(queue) : undefined)
  const q = item?.q
  // Templates are written per subtopic, so the offer only appears where one exists.
  const templates = item ? templatesFor(item.subunitId) : []

  function toggle(subId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(subId)) next.delete(subId)
      else next.add(subId)
      return next
    })
  }

  function start() {
    if (pool.length === 0) return
    setQueue(startQueue(pool, Math.random))
    setGenerated(null)
    setResult(null)
    setGraded(false)
    setAttempt((a) => a + 1)
    setAsked(0)
    setRight(0)
    setAnswers([])
    setScreen('practice')
  }

  function onSubmit(ok: boolean) {
    if (!graded) {
      recordAnswer(ok)
      setGraded(true)
      setAsked((n) => n + 1)
      if (ok) setRight((n) => n + 1)
      if (item) setAnswers((a) => [...a, { subunitId: item.subunitId, subunitName: item.subunitName, correct: ok }])
    }
    setResult(ok)
  }

  // Another go at the SAME question — the first try is already counted.
  function retry() {
    setResult(null)
    setAttempt((a) => a + 1)
  }

  function next() {
    // The queue advances either way. A generated question is a detour taken
    // AFTER its authored one was already answered, so staying put would ask that
    // question a second time — with its answer still on screen, and counting it
    // twice in both the summary and the lifetime accuracy.
    setGenerated(null)
    setQueue((cur) => (cur ? advance(cur, Math.random) : cur))
    setResult(null)
    setGraded(false)
    setAttempt((a) => a + 1)
  }

  /**
   * Another question of the same shape: same structure, different numbers.
   * Built here and now from the subtopic's template — no network, no waiting,
   * and the answer is worked out rather than looked up, so it cannot be wrong.
   */
  function moreLikeThis() {
    if (!item || templates.length === 0) return
    const t = templates[Math.floor(Math.random() * templates.length)]
    const made = instantiate(t, Math.random)
    // A template that can't produce a question is an authoring bug, not
    // something to show the player — leave the question they have.
    if (!made.ok) { console.warn(`[eclipse-arcade] template "${t.id}": ${made.reason}`); return }
    setGenerated({ q: made.question, subunitId: item.subunitId, subunitName: item.subunitName })
    setResult(null)
    setGraded(false)
    setAttempt((a) => a + 1)
  }

  function goBack() {
    if (screen === 'course') { navigate('/'); return }
    if (screen === 'unit') { setScreen('course'); return }
    if (screen === 'topics') { setUnitId(null); setScreen('unit'); return }
    // Leaving a session mid-way still earns the summary — it's the point of
    // having practised, not a reward for reaching some end.
    if (screen === 'practice') { setScreen(answers.length > 0 ? 'summary' : 'topics'); return }
    setScreen('topics')
  }

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={goBack}
            className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </button>
          <h1 className="flex items-center gap-2 font-pixel text-[12px]" style={{ color: ACCENT_TEXT }}>
            <Book width={16} height={16} aria-hidden />PRACTICE
          </h1>
          <div aria-hidden className="w-10 h-10" />
        </div>

        {screen === 'course' && (
          <Section title="CHOOSE A COURSE" hint="Practice is untimed and unscored — work through as many as you like.">
            <div className="grid gap-3 sm:grid-cols-2">
              {COURSE_LIST.map((c) => {
                const preferred = c.id === preferredCourseId
                return (
                  <button key={c.id}
                    onClick={() => { setCourseId(c.id); setUnitId(null); setSelected(new Set()); setScreen('unit') }}
                    aria-label={preferred ? `${c.name} — your math level` : c.name}
                    className={`text-left rounded-xl border bg-white/[0.03] p-4 transition ${preferred ? '' : 'border-white/10 hover:border-white/30'}`}
                    style={preferred ? { borderColor: `${ACCENT}b0` } : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{c.name}</span>
                      {preferred && (
                        <span className="shrink-0 font-sans text-[10px] font-bold tracking-wide px-2 py-1 rounded"
                          style={{ background: `${ACCENT}33`, color: ACCENT_TEXT }}>YOUR LEVEL</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {screen !== 'course' && !course && (
          <p className="text-center text-white/70 font-sans text-sm py-16">Loading course…</p>
        )}

        {screen === 'unit' && course && (
          <Section title="CHOOSE A UNIT" hint={course.name}>
            {course.units.length === 0 ? (
              <Empty>This course has no units yet.</Empty>
            ) : (
              <div className="grid gap-2.5">
                {course.units.map((u) => {
                  const count = unitQuestionCount(u)
                  return (
                    // An outline-only unit stays focusable (aria-disabled, not
                    // `disabled`) so the plan is still readable to a keyboard or
                    // screen-reader user — the same pattern Ascend's picker uses.
                    <button key={u.id} aria-disabled={count === 0}
                      onClick={() => { if (count > 0) { setUnitId(u.id); setSelected(new Set()); setScreen('topics') } }}
                      className={`text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 transition ${count === 0 ? 'opacity-45 cursor-default' : 'hover:border-white/30'}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-bold">{u.name}</span>
                        <span className="shrink-0 text-xs text-white/55 tabular-nums">
                          {count === 0 ? 'No questions yet' : `${count} question${count === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      {u.description && <p className="mt-1 text-xs text-white/55">{u.description}</p>}
                    </button>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {screen === 'topics' && course && unit && (
          <Section title="CHOOSE SUBTOPICS" hint={`${course.name} · ${unit.name}`}>
            <div className="flex items-center justify-between mb-4 rounded-lg bg-white/[0.03] border border-white/10 px-4 py-2.5">
              <span className="font-sans text-xs font-semibold tracking-wide text-white/80">
                {selected.size} selected · {pool.length} question{pool.length === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setSelected(new Set(unit.subunits.filter((s) => s.questions.length > 0).map((s) => s.id)))}
                  className="font-sans text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                  All
                </button>
                <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
                  className="font-sans text-xs font-semibold px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">
                  Clear
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {unit.subunits.map((s) => (
                <TopicButton key={s.id} s={s} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </div>

            <div className="mt-7 flex flex-col items-center gap-2">
              <button onClick={start} disabled={pool.length === 0}
                className="font-sans font-bold text-sm tracking-wide px-8 py-3.5 rounded-lg text-[#0a0620] disabled:opacity-40 transition"
                style={{ background: ACCENT, boxShadow: pool.length > 0 ? `0 6px 20px -6px ${ACCENT}` : 'none' }}>
                Start practicing
              </button>
              {pool.length === 0 && <span className="text-xs text-white/60">Pick a subtopic that has questions.</span>}
            </div>
          </Section>
        )}

        {screen === 'practice' && course && unit && (
          <div>
            <div className="text-center mb-4">
              <p className="font-sans text-xs text-white/55">{course.name} · {unit.name}</p>
              <p className="mt-2 font-pixel text-[10px] text-white/80 tabular-nums">
                {right}/{asked} CORRECT
                {accuracy(asked, right) !== null && <span style={{ color: ACCENT_TEXT }}> · {Math.round((accuracy(asked, right) ?? 0) * 100)}%</span>}
              </p>
            </div>

            {!q ? (
              <Empty>Nothing to practice here yet.</Empty>
            ) : result === null ? (
              <QuestionPanel key={attempt} q={q} color={ACCENT} onSubmit={onSubmit} surface="plain" label="PRACTICE" />
            ) : (
              <div aria-live="polite" className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-center font-sans font-bold text-xs tracking-[0.18em] mb-3"
                  style={{ color: result ? OK : MISS }}>
                  {result ? 'CORRECT' : 'NOT QUITE'}
                </div>
                <p className="text-center text-lg font-semibold mb-3">{q.prompt}</p>
                {!result && (
                  <p className="text-center text-sm text-white/85 mb-2">
                    Answer: <span className="font-bold" style={{ color: ACCENT_TEXT }}>{answerText(q)}</span>
                  </p>
                )}
                {q.explain && <p className="text-center text-xs text-white/65 mb-2">{q.explain}</p>}
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button onClick={next} className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={BTN}>
                    NEXT
                  </button>
                  {!result && (
                    <button onClick={retry}
                      className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                      TRY AGAIN
                    </button>
                  )}
                  {templates.length > 0 && (
                    <button onClick={moreLikeThis}
                      className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                      ONE MORE LIKE THIS
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={() => setScreen('summary')} disabled={answers.length === 0}
                className="font-sans text-xs font-semibold px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 enabled:hover:bg-white/10 disabled:opacity-40">
                Finish &amp; see how you did
              </button>
              <button onClick={() => setScreen('topics')}
                className="font-sans text-xs font-semibold px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                Change subtopics
              </button>
              <button onClick={() => navigate('/')}
                className="font-sans text-xs font-semibold px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                Back to arcade
              </button>
            </div>
          </div>
        )}

        {screen === 'summary' && course && unit && (
          <div>
            <div className="text-center mb-4">
              <p className="font-sans text-xs text-white/55">{course.name} · {unit.name}</p>
            </div>
            <SessionSummary summary={summarize(answers)} color={ACCENT} />
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={start}
                className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={BTN}>
                PRACTICE AGAIN
              </button>
              <button onClick={() => setScreen('topics')}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                NEW TOPICS
              </button>
              <button onClick={() => navigate('/')}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
                ARCADE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TopicButton({ s, checked, onToggle }: { s: Subunit; checked: boolean; onToggle: () => void }) {
  const empty = s.questions.length === 0
  return (
    <button role="checkbox" aria-checked={checked} aria-disabled={empty}
      onClick={() => { if (!empty) onToggle() }}
      className={`flex items-start gap-3 text-left rounded-lg border p-3 transition ${empty ? 'opacity-45 cursor-default border-white/10' : 'border-white/10 hover:border-white/30'}`}
      style={checked ? { borderColor: ACCENT, background: `${ACCENT}1f` } : undefined}>
      <span aria-hidden className="grid place-items-center w-5 h-5 mt-0.5 rounded border shrink-0"
        style={{ borderColor: checked ? ACCENT : 'rgba(255,255,255,0.4)', background: checked ? ACCENT : 'transparent' }}>
        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a0733" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold truncate">{s.name}</span>
          <DiffBadge d={s.difficulty} />
        </span>
        {s.description && <span className="block text-xs text-white/55 mt-0.5">{s.description}</span>}
        <span className="block text-xs text-white/55 mt-0.5">
          {empty ? 'No questions yet' : `${s.questions.length} question${s.questions.length === 1 ? '' : 's'}`}
          {hasTemplate(s.id) && (
            <span className="ml-2" style={{ color: ACCENT_TEXT }}>+ unlimited practice</span>
          )}
        </span>
      </span>
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="font-pixel text-[12px] tracking-wide text-center" style={{ color: ACCENT_TEXT }}>{title}</h2>
      {hint && <p className="mt-2 mb-6 text-center text-sm text-white/60">{hint}</p>}
      {!hint && <div className="mb-6" />}
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-white/60 py-10">{children}</p>
}

function DiffBadge({ d }: { d: Difficulty }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="shrink-0 text-[10px] font-sans font-bold tracking-wide px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
