import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { COURSES, type Course, type Subunit, type Question, type Difficulty } from '../data/subjects'
import { fetchRemoteCourse, saveCourse, draftIssue } from '../lib/content'
import { isFirebaseConfigured } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import AccountControl from '../components/AccountControl'
import { ArrowLeft } from '../icons'

// Admin question editor: edits arcadeContent/{courseId} in Firestore as one
// whole doc (see lib/content.ts). The isAdmin gate here is CLIENT gating for
// the UI only — firestore.rules (isArcadeAdmin) is the real enforcement; a
// non-admin who bypasses this page simply gets permission-denied on save.

const AM = '#ffb43d'
const AM_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': AM, '--edge': `color-mix(in srgb, ${AM} 50%, #000)`, '--glow': `${AM}88`,
}
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']

const clone = (c: Course): Course => JSON.parse(JSON.stringify(c)) as Course

function newQuestion(type: Subunit['type']): Question {
  switch (type) {
    case 'graph': return { prompt: '', x: 0, y: 0, range: 8 }
    case 'slider': return { prompt: '', answer: 0, min: 0, max: 10, step: 1 }
    case 'fill': return { prompt: '', fill: '' }
  }
}

// Immutable nested update: replace subunit (ui, si) via `fn`.
function withSubunit(c: Course, ui: number, si: number, fn: (s: Subunit) => Subunit): Course {
  return {
    ...c,
    units: c.units.map((u, i) => (i !== ui ? u : { ...u, subunits: u.subunits.map((s, j) => (j !== si ? s : fn(s))) })),
  }
}

export default function Admin() {
  const { user, loading, isAdmin } = useAuth()
  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" aria-label="Back to arcade" className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </Link>
          <h1 className="font-pixel text-[12px]" style={{ color: AM }}>QUESTION EDITOR</h1>
          <div className="w-10 h-10 grid place-items-center">{isFirebaseConfigured && <AccountControl />}</div>
        </div>

        {!isFirebaseConfigured ? (
          <Gate title="EDITOR OFFLINE">Firebase is not configured — the question editor needs the live backend.</Gate>
        ) : loading ? (
          <p className="text-center text-white/70 font-pixel text-[10px] py-16">CHECKING ACCESS…</p>
        ) : !user || !isAdmin ? (
          <Gate title="ADMINS ONLY">
            Sign in with an admin account (top-right) to edit the arcade curriculum.
            This page only hides the controls — Firestore security rules are what actually enforce admin-only writes.
          </Gate>
        ) : (
          <Editor email={user.email ?? ''} />
        )}
      </div>
    </div>
  )
}

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-md mx-auto text-center rounded-2xl border-2 border-white/15 bg-[#120a2c] px-6 py-10 mt-10">
      <h2 className="font-pixel text-[13px] tracking-wider neon-text mb-4" style={{ color: AM }}>{title}</h2>
      <p className="text-sm text-white/80 leading-relaxed">{children}</p>
    </div>
  )
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  // saved = JSON snapshot of the last loaded/saved draft, for the dirty check.
  // docExists=false → the Firestore doc is missing and SEED is offered.
  | { phase: 'ready'; draft: Course; saved: string; docExists: boolean; note: string | null }

function Editor({ email }: { email: string }) {
  const [courseId, setCourseId] = useState(COURSES[0].id)
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    setSaveError('')
    const bundled = COURSES.find((c) => c.id === courseId)
    if (!bundled) { setState({ phase: 'error', message: `Unknown course: ${courseId}` }); return }
    fetchRemoteCourse(courseId)
      .then((remote) => {
        if (cancelled) return
        if (remote.status === 'ok') {
          setState({ phase: 'ready', draft: remote.course, saved: JSON.stringify(remote.course), docExists: true, note: null })
        } else {
          const draft = clone(bundled)
          setState({
            phase: 'ready', draft, saved: JSON.stringify(draft), docExists: false,
            note: remote.status === 'invalid'
              ? 'The Firestore doc for this course is malformed — editing the bundled copy. Saving will overwrite it.'
              : 'No Firestore doc for this course yet — editing the bundled copy. Seed or save to create it.',
          })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to load course content.' })
      })
    return () => { cancelled = true }
  }, [courseId, reloadKey])

  const update = (fn: (c: Course) => Course) =>
    setState((s) => (s.phase === 'ready' ? { ...s, draft: fn(s.draft) } : s))

  async function write(course: Course, resetDraft: boolean) {
    const issue = resetDraft ? null : draftIssue(course)
    if (issue) { setSaveError(issue); return }
    setSaving(true)
    setSaveError('')
    try {
      await saveCourse(course, email)
      setState((s) => (s.phase === 'ready'
        ? { ...s, draft: resetDraft ? clone(course) : s.draft, saved: JSON.stringify(course), docExists: true, note: null }
        : s))
      setFlash(true)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') return <p className="text-center text-white/70 font-pixel text-[10px] py-16">LOADING CONTENT…</p>
  if (state.phase === 'error') {
    return (
      <div className="max-w-md mx-auto text-center py-10">
        <p role="alert" className="text-sm text-[#ff9dbd] mb-5">{state.message}</p>
        <button onClick={() => setReloadKey((k) => k + 1)} className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620]" style={AM_BTN}>
          RETRY
        </button>
      </div>
    )
  }

  const { draft, saved, docExists, note } = state
  const dirty = JSON.stringify(draft) !== saved

  return (
    <div className="pb-28">
      <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div>
          <label htmlFor="course-pick" className="block font-pixel text-[8px] tracking-wider text-white/80 mb-2">COURSE</label>
          <select
            id="course-pick" value={courseId}
            onChange={(e) => {
              // Cancelling must also revert the DOM select: no state change
              // means no re-render, so React won't reset it for us.
              if (dirty && !window.confirm('Discard unsaved changes?')) { e.target.value = courseId; return }
              setCourseId(e.target.value)
            }}
            className="rounded-lg bg-white/5 border border-white/15 px-3 py-2 text-sm text-white"
          >
            {COURSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="text-xs text-white/60">
          {draft.units.length} units · {draft.units.reduce((n, u) => n + u.subunits.length, 0)} topics · {draft.units.reduce((n, u) => n + u.subunits.reduce((m, s) => m + s.questions.length, 0), 0)} questions
        </div>
      </div>

      {note && <p className="mb-5 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-4 py-3 text-sm text-[#ffd694]">{note}</p>}

      <div className="space-y-3">
        {draft.units.map((unit, ui) => (
          <details key={unit.id} open={ui === 0} className="rounded-xl border border-white/10 bg-white/[0.03]">
            <summary className="cursor-pointer select-none px-4 py-3 font-pixel text-[10px] tracking-wider text-white/90 hover:text-white">
              {unit.name.toUpperCase()}
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {unit.subunits.map((sub, si) => (
                <SubunitEditor
                  key={sub.id} sub={sub}
                  onPatch={(patch) => update((c) => withSubunit(c, ui, si, (s) => ({ ...s, ...patch })))}
                  onQuestions={(fn) => update((c) => withSubunit(c, ui, si, (s) => ({ ...s, questions: fn(s.questions) })))}
                />
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Save bar — fixed so the action and its status are always reachable. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-[#0d0724]/95 backdrop-blur px-5 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {dirty && <span className="font-pixel text-[8px] px-2 py-1 rounded bg-neon-amber/15 text-neon-amber whitespace-nowrap">UNSAVED CHANGES</span>}
            <span aria-live="polite" className="font-pixel text-[8px] text-neon-green whitespace-nowrap">{flash ? 'SAVED' : ''}</span>
            {saveError && <p role="alert" className="text-sm text-[#ff9dbd] truncate" title={saveError}>{saveError}</p>}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {!docExists && (
              <button
                onClick={() => {
                  if (dirty && !window.confirm('Seeding uploads the pristine bundled course and discards your edits. Continue?')) return
                  void write(clone(COURSES.find((c) => c.id === courseId) ?? draft), true)
                }}
                disabled={saving}
                className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 hover:border-neon-amber/40 disabled:opacity-60"
              >
                SEED FROM BUNDLED
              </button>
            )}
            <button
              onClick={() => { void write(draft, false) }}
              disabled={saving}
              className="arcade-btn font-pixel text-[10px] px-6 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60"
              style={AM_BTN}
            >
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SubunitEditor({ sub, onPatch, onQuestions }: {
  sub: Subunit
  onPatch: (patch: Partial<Subunit>) => void
  onQuestions: (fn: (qs: Question[]) => Question[]) => void
}) {
  const diffId = `diff-${sub.id}`
  return (
    <details className="rounded-lg border border-white/10 bg-white/[0.03]">
      <summary className="cursor-pointer select-none px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-bold text-white/90">{sub.name}</span>
        <span className="flex items-center gap-2 text-[9px] font-pixel">
          <span className="px-2 py-1 rounded bg-white/10 text-white/80 uppercase">{sub.type}</span>
          <span className="text-white/60">{sub.questions.length} Q</span>
        </span>
      </summary>
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <label htmlFor={diffId} className="font-pixel text-[8px] tracking-wider text-white/80">DIFFICULTY</label>
          <select id={diffId} value={sub.difficulty} onChange={(e) => onPatch({ difficulty: e.target.value as Difficulty })}
            className="rounded-lg bg-white/5 border border-white/15 px-2 py-1.5 text-xs text-white">
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <ol className="space-y-3">
          {sub.questions.map((q, qi) => (
            <QuestionEditor
              key={qi} q={q} index={qi} type={sub.type} subId={sub.id} count={sub.questions.length}
              onPatch={(patch) => onQuestions((qs) => qs.map((x, k) => (k === qi ? { ...x, ...patch } : x)))}
              onMove={(dir) => onQuestions((qs) => {
                const to = qi + dir
                if (to < 0 || to >= qs.length) return qs
                const next = [...qs]
                ;[next[qi], next[to]] = [next[to], next[qi]]
                return next
              })}
              onDelete={() => {
                if (!window.confirm(`Delete question ${qi + 1} of "${sub.name}"?`)) return
                onQuestions((qs) => qs.filter((_, k) => k !== qi))
              }}
            />
          ))}
        </ol>
        <button
          onClick={() => onQuestions((qs) => [...qs, newQuestion(sub.type)])}
          className="mt-3 font-pixel text-[9px] px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 hover:border-neon-amber/40"
        >
          + ADD {sub.type.toUpperCase()} QUESTION
        </button>
      </div>
    </details>
  )
}

function QuestionEditor({ q, index, type, subId, count, onPatch, onMove, onDelete }: {
  q: Question
  index: number
  type: Subunit['type']
  subId: string
  count: number
  onPatch: (patch: Partial<Question>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const id = (field: string) => `q-${subId}-${index}-${field}`
  const num = (field: 'x' | 'y' | 'range' | 'answer' | 'min' | 'max' | 'step', label: string) => (
    <LabeledField id={id(field)} label={label}>
      <input
        id={id(field)} type="number" step="any" value={q[field] ?? ''}
        onChange={(e) => {
          const n = e.target.valueAsNumber
          onPatch({ [field]: Number.isNaN(n) ? undefined : n })
        }}
        className="w-full rounded-lg bg-white/5 border border-white/15 px-2.5 py-2 text-sm text-white"
      />
    </LabeledField>
  )

  return (
    <li className="rounded-lg border border-white/10 bg-[#0d0724] p-3">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <span className="font-pixel text-[9px] pt-2" style={{ color: AM }}>Q{index + 1}</span>
        <div className="flex items-center gap-1.5">
          <MiniBtn label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>UP</MiniBtn>
          <MiniBtn label={`Move question ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>DN</MiniBtn>
          <MiniBtn label={`Delete question ${index + 1}`} danger onClick={onDelete}>DEL</MiniBtn>
        </div>
      </div>
      <LabeledField id={id('prompt')} label="PROMPT">
        <input
          id={id('prompt')} type="text" value={q.prompt} onChange={(e) => onPatch({ prompt: e.target.value })}
          className="w-full rounded-lg bg-white/5 border border-white/15 px-2.5 py-2 text-sm text-white"
        />
      </LabeledField>
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {type === 'graph' && (<>{num('x', 'X')}{num('y', 'Y')}{num('range', 'RANGE (OPT)')}</>)}
        {type === 'slider' && (<>{num('answer', 'ANSWER')}{num('min', 'MIN')}{num('max', 'MAX')}{num('step', 'STEP (OPT)')}</>)}
        {type === 'fill' && (
          <div className="col-span-2">
            <LabeledField id={id('fill')} label="ANSWER">
              <input
                id={id('fill')} type="text" value={q.fill ?? ''} onChange={(e) => onPatch({ fill: e.target.value })}
                className="w-full rounded-lg bg-white/5 border border-white/15 px-2.5 py-2 text-sm text-white"
              />
            </LabeledField>
          </div>
        )}
      </div>
      <div className="mt-2.5">
        <LabeledField id={id('explain')} label="EXPLAIN (OPT)">
          <input
            id={id('explain')} type="text" value={q.explain ?? ''}
            onChange={(e) => onPatch({ explain: e.target.value === '' ? undefined : e.target.value })}
            className="w-full rounded-lg bg-white/5 border border-white/15 px-2.5 py-2 text-sm text-white"
          />
        </LabeledField>
      </div>
    </li>
  )
}

function LabeledField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block font-pixel text-[7px] tracking-wider text-white/80 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function MiniBtn({ label, disabled, danger, onClick, children }: {
  label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: ReactNode
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label}
      className={`font-pixel text-[8px] px-2 py-1.5 rounded border transition disabled:opacity-30 ${danger
        ? 'border-[#ff4d8d]/40 text-[#ff9dbd] hover:bg-[#ff4d8d]/15'
        : 'border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
    >
      {children}
    </button>
  )
}
