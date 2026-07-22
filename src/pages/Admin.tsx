import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { COURSES, type Course, type Unit, type Subunit, type Question, type Difficulty, type AnswerType } from '../data/subjects'
import { fetchRemoteCourse, saveCourse, draftIssue, slugify, uniqueId } from '../lib/content'
import { isFirebaseConfigured } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { ArrowLeft } from '../icons'

// Admin content editor: edits arcadeContent/{courseId} in Firestore as one whole
// doc (see lib/content.ts). Structure (units + subunits) and questions are both
// editable here. The isAdmin gate is CLIENT gating for the UI only —
// firestore.rules (isArcadeAdmin) is the real enforcement; a non-admin who
// bypasses this page simply gets permission-denied on save.
//
// Unlike the rest of the arcade (neon-on-dark), this page wears the calm Eclipse
// Learning aesthetic — a comfortable writing desk for authoring content. It sets
// document.documentElement[data-plain] on mount so index.css can suppress the
// global CRT/neon overlays for this route only, and restores them on unmount.

// Calm Eclipse-Learning palette (matches ~/app/studyreel-web tokens). Espresso
// accent shifted one shade darker than the sibling's #B5610F so cream-on-accent
// clears WCAG AA (~5.3:1) for the small button labels here.
const ACCENT = '#9C5410'
const INPUT =
  'w-full rounded-lg bg-[#FBFDFF] border border-[#CADDEE] px-3 py-2 text-sm text-[#1F2A36] focus:border-[#2F6FB0] outline-none'
const SELECT =
  'rounded-lg bg-[#FBFDFF] border border-[#CADDEE] px-3 py-2 text-sm text-[#1F2A36] focus:border-[#2F6FB0] outline-none'
const SECONDARY_BTN =
  'rounded-lg bg-[#EDF5FC] border border-[#CADDEE] px-4 py-2 text-sm font-semibold text-[#1F2A36] hover:bg-[#E1EEF9] disabled:opacity-50 transition-colors'

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']
const ANSWER_TYPES: readonly AnswerType[] = ['graph', 'slider', 'fill']

const clone = (c: Course): Course => JSON.parse(JSON.stringify(c)) as Course

function newQuestion(type: AnswerType): Question {
  switch (type) {
    case 'graph': return { prompt: '', x: 0, y: 0, range: 8 }
    case 'slider': return { prompt: '', answer: 0, min: 0, max: 10, step: 1 }
    case 'fill': return { prompt: '', fill: '' }
  }
}

// Every subunit id currently in the course — the pool a new subunit's id must
// avoid (subunit ids are course-unique: findSubunit searches all units).
function subunitIds(c: Course): Set<string> {
  const ids = new Set<string>()
  for (const u of c.units) for (const s of u.subunits) ids.add(s.id)
  return ids
}

function newSubunit(c: Course, name: string, type: AnswerType, difficulty: Difficulty): Subunit {
  return { id: uniqueId(slugify(name), subunitIds(c)), name: name.trim(), difficulty, type, questions: [] }
}

function newUnit(c: Course, name: string, description: string): Unit {
  const id = uniqueId(slugify(name), new Set(c.units.map((u) => u.id)))
  const unit: Unit = { id, name: name.trim(), subunits: [] }
  const desc = description.trim()
  if (desc !== '') unit.description = desc
  return unit
}

// Rebuilds a unit's description — empty string drops the optional field entirely.
function withDescription(unit: Unit, desc: string): Unit {
  const next: Unit = { id: unit.id, name: unit.name, subunits: unit.subunits }
  if (desc !== '') next.description = desc
  return next
}

// Immutable reorder: swap element `i` with its neighbour in `dir`.
function moved<T>(arr: readonly T[], i: number, dir: -1 | 1): T[] {
  const to = i + dir
  if (to < 0 || to >= arr.length) return [...arr]
  const next = [...arr]
  ;[next[i], next[to]] = [next[to], next[i]]
  return next
}

// Immutable nested updates.
function withUnit(c: Course, ui: number, fn: (u: Unit) => Unit): Course {
  return { ...c, units: c.units.map((u, i) => (i !== ui ? u : fn(u))) }
}
function withSubunit(c: Course, ui: number, si: number, fn: (s: Subunit) => Subunit): Course {
  return withUnit(c, ui, (u) => ({ ...u, subunits: u.subunits.map((s, j) => (j !== si ? s : fn(s))) }))
}

export default function Admin() {
  const { user, loading, isAdmin } = useAuth()

  // Suppress the global arcade CRT/neon overlays for this route only. index.css
  // hides body::before/after and swaps the body background under :root[data-plain].
  // Removed on unmount so every other page keeps the full neon treatment.
  useEffect(() => {
    document.documentElement.setAttribute('data-plain', '')
    return () => document.documentElement.removeAttribute('data-plain')
  }, [])

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/" aria-label="Back to arcade"
            className="grid place-items-center w-10 h-10 rounded-xl bg-[#FBFDFF] border border-[#CADDEE] text-[#566573] hover:text-[#1F2A36] hover:bg-[#EDF5FC] transition-colors"
          >
            <ArrowLeft width={18} height={18} />
          </Link>
          <h1 className="text-lg font-bold tracking-tight text-[#1F2A36]">Content Editor</h1>
          <div className="min-w-[40px] flex justify-end">{isFirebaseConfigured && <CalmAccount />}</div>
        </div>

        {!isFirebaseConfigured ? (
          <Gate title="Editor offline">Firebase is not configured — the content editor needs the live backend.</Gate>
        ) : loading ? (
          <StatusCard>Checking access…</StatusCard>
        ) : !user ? (
          <Gate
            title="Admins only"
            action={<GoogleGateButton />}
          >
            Sign in with an admin account to edit the arcade curriculum.
            This page only hides the controls — Firestore security rules are what actually enforce admin-only writes.
          </Gate>
        ) : !isAdmin ? (
          <Gate
            title="Admins only"
            action={<GateSignOutButton />}
          >
            This account doesn't have editor access. Sign out and sign back in with an admin account.
          </Gate>
        ) : (
          <Editor email={user.email ?? ''} />
        )}
      </div>
    </div>
  )
}

// A quiet, calm-palette account control for the /admin header. The user reaching
// this component is always signed in (the gate blocks otherwise); it shows their
// email plus an ADMIN tag and a plain "Sign out" text button — no neon, no
// font-pixel, no dark modal. The global :root[data-plain] :focus-visible rule
// gives every control here the dark #2F6FB0 focus ring.
function CalmAccount() {
  const { user, isAdmin, signOut } = useAuth()
  const [error, setError] = useState('')
  if (!user) return null
  const handleSignOut = async () => {
    const res = await signOut()
    if (res.status === 'error') setError(res.message)
  }
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {error && <span role="alert" className="text-xs text-[#B4232B] truncate" title={error}>{error}</span>}
      {isAdmin && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDF5FC] border border-[#CADDEE] text-[#3A4653]">
          Admin
        </span>
      )}
      <span className="text-sm text-[#1F2A36] truncate max-w-[180px]" title={user.email ?? undefined}>
        {user.email}
      </span>
      <button
        onClick={() => void handleSignOut()}
        className="shrink-0 rounded text-sm font-semibold hover:underline underline-offset-2"
        style={{ color: ACCENT }}
      >
        Sign out
      </button>
    </div>
  )
}

// Calm signed-out affordance on the gate: admins use Google, so a single
// light-themed "Continue with Google" button is enough — no neon sign-in modal.
function GoogleGateButton() {
  const { signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const onClick = async () => {
    setError('')
    setBusy(true)
    const res = await signInWithGoogle()
    setBusy(false)
    if (res.status === 'error') setError(res.message)
    // 'cancelled' (popup closed) is benign — leave the gate as-is.
  }
  return (
    <div>
      <button
        onClick={() => void onClick()}
        disabled={busy}
        className="rounded-lg px-5 py-2.5 text-sm font-semibold text-[#FBF3E7] hover:brightness-95 disabled:opacity-50 transition"
        style={{ backgroundColor: ACCENT }}
      >
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-[#B4232B]">{error}</p>}
    </div>
  )
}

// Signed-in-but-not-an-admin: offer a calm sign-out so they can switch accounts.
function GateSignOutButton() {
  const { signOut } = useAuth()
  const [error, setError] = useState('')
  const onClick = async () => {
    const res = await signOut()
    if (res.status === 'error') setError(res.message)
  }
  return (
    <div>
      <button onClick={() => void onClick()} className={SECONDARY_BTN}>Sign out</button>
      {error && <p role="alert" className="mt-3 text-sm text-[#B4232B]">{error}</p>}
    </div>
  )
}

function Gate({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="max-w-md mx-auto text-center rounded-2xl border border-[#CADDEE] bg-[#FBFDFF] shadow-sm px-6 py-10 mt-10">
      <h2 className="text-base font-bold text-[#1F2A36] mb-3">{title}</h2>
      <p className="text-sm text-[#566573] leading-relaxed">{children}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

// Transient loading/checking states, carded onto a solid #FBFDFF surface so the
// muted text clears AA (it fails on the bare light-blue body gradient).
function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-md mx-auto text-center rounded-2xl border border-[#CADDEE] bg-[#FBFDFF] shadow-sm px-6 py-10 mt-10">
      <p className="text-sm text-[#566573]">{children}</p>
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

  // Reset to bundled: load the built-in course into the draft, replacing whatever
  // is loaded (cloud copy, emptied doc, or unsaved edits). saved stays put so the
  // draft reads dirty and the recovery is completed by clicking SAVE (which
  // overwrites the cloud doc). This is the fix path even when a doc already
  // exists — unlike SEED, which only appears for a missing doc.
  const resetToBundled = () => {
    const bundled = COURSES.find((c) => c.id === courseId)
    if (!bundled) return
    if (!window.confirm('This replaces the current course with the built-in version. Unsaved and saved cloud changes for this course will be overwritten on Save. Continue?')) return
    setSaveError('')
    update(() => clone(bundled))
  }

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

  if (state.phase === 'loading') return <StatusCard>Loading content…</StatusCard>
  if (state.phase === 'error') {
    return (
      <div className="max-w-md mx-auto text-center rounded-2xl border border-[#CADDEE] bg-[#FBFDFF] shadow-sm px-6 py-10 mt-10">
        <p role="alert" className="text-sm text-[#B4232B] mb-5">{state.message}</p>
        <button onClick={() => setReloadKey((k) => k + 1)} className={SECONDARY_BTN}>Retry</button>
      </div>
    )
  }

  const { draft, saved, docExists, note } = state
  const dirty = JSON.stringify(draft) !== saved

  return (
    <div className="pb-28">
      <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div>
          <label htmlFor="course-pick" className="block text-xs font-semibold uppercase tracking-wide text-[#566573] mb-2">Course</label>
          <select
            id="course-pick" value={courseId}
            onChange={(e) => {
              // Cancelling must also revert the DOM select: no state change
              // means no re-render, so React won't reset it for us.
              if (dirty && !window.confirm('Discard unsaved changes?')) { e.target.value = courseId; return }
              setCourseId(e.target.value)
            }}
            className={SELECT}
          >
            {COURSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="text-xs text-[#566573]">
          {draft.units.length} units · {draft.units.reduce((n, u) => n + u.subunits.length, 0)} topics · {draft.units.reduce((n, u) => n + u.subunits.reduce((m, s) => m + s.questions.length, 0), 0)} questions
        </div>
      </div>

      {note && <p className="mb-5 rounded-lg border border-[#E7CFA0] bg-[#FBF1E0] px-4 py-3 text-sm text-[#7A4B12]">{note}</p>}

      <div className="space-y-3">
        {draft.units.map((unit, ui) => (
          <UnitEditor
            key={unit.id}
            unit={unit}
            open={ui === 0}
            isFirst={ui === 0}
            isLast={ui === draft.units.length - 1}
            onPatch={(patch) => update((c) => withUnit(c, ui, (u) => ({ ...u, ...patch })))}
            onDescription={(desc) => update((c) => withUnit(c, ui, (u) => withDescription(u, desc)))}
            onMove={(dir) => update((c) => ({ ...c, units: moved(c.units, ui, dir) }))}
            onDelete={() => {
              if (!window.confirm(`Delete unit "${unit.name}" and its ${unit.subunits.length} topic(s)?`)) return
              update((c) => ({ ...c, units: c.units.filter((_, i) => i !== ui) }))
            }}
            onAddSubunit={(name, type, difficulty) =>
              update((c) => withUnit(c, ui, (u) => ({ ...u, subunits: [...u.subunits, newSubunit(c, name, type, difficulty)] })))}
            onPatchSubunit={(si, patch) => update((c) => withSubunit(c, ui, si, (s) => ({ ...s, ...patch })))}
            onSubunitQuestions={(si, fn) => update((c) => withSubunit(c, ui, si, (s) => ({ ...s, questions: fn(s.questions) })))}
            onMoveSubunit={(si, dir) => update((c) => withUnit(c, ui, (u) => ({ ...u, subunits: moved(u.subunits, si, dir) })))}
            onDeleteSubunit={(si, sub) => {
              if (!window.confirm(`Delete topic "${sub.name}" and its ${sub.questions.length} question(s)?`)) return
              update((c) => withUnit(c, ui, (u) => ({ ...u, subunits: u.subunits.filter((_, j) => j !== si) })))
            }}
          />
        ))}
      </div>

      <AddUnitForm onAdd={(name, description) => update((c) => ({ ...c, units: [...c.units, newUnit(c, name, description)] }))} />

      {/* Save bar — fixed so the action and its status are always reachable. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-[#CADDEE] bg-[#FBFDFF]/95 backdrop-blur px-5 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {dirty && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FBF1E0] text-[#7A4B12] whitespace-nowrap">Unsaved changes</span>}
            <span aria-live="polite" className="text-xs font-semibold text-[#1E7A46] whitespace-nowrap">{flash ? 'Saved' : ''}</span>
            {saveError && <p role="alert" className="text-sm text-[#B4232B] truncate" title={saveError}>{saveError}</p>}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button onClick={resetToBundled} disabled={saving} className={SECONDARY_BTN}>
              Reset to bundled
            </button>
            {!docExists && (
              <button
                onClick={() => {
                  if (dirty && !window.confirm('Seeding uploads the pristine bundled course and discards your edits. Continue?')) return
                  void write(clone(COURSES.find((c) => c.id === courseId) ?? draft), true)
                }}
                disabled={saving}
                className={SECONDARY_BTN}
              >
                Seed from bundled
              </button>
            )}
            <button
              onClick={() => { void write(draft, false) }}
              disabled={saving}
              className="rounded-lg px-6 py-2.5 text-sm font-semibold text-[#FBF3E7] hover:brightness-95 disabled:opacity-50 transition"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function UnitEditor({
  unit, open, isFirst, isLast,
  onPatch, onDescription, onMove, onDelete,
  onAddSubunit, onPatchSubunit, onSubunitQuestions, onMoveSubunit, onDeleteSubunit,
}: {
  unit: Unit
  open: boolean
  isFirst: boolean
  isLast: boolean
  onPatch: (patch: Partial<Pick<Unit, 'name'>>) => void
  onDescription: (desc: string) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onAddSubunit: (name: string, type: AnswerType, difficulty: Difficulty) => void
  onPatchSubunit: (si: number, patch: Partial<Subunit>) => void
  onSubunitQuestions: (si: number, fn: (qs: Question[]) => Question[]) => void
  onMoveSubunit: (si: number, dir: -1 | 1) => void
  onDeleteSubunit: (si: number, sub: Subunit) => void
}) {
  const nameId = `unit-name-${unit.id}`
  const descId = `unit-desc-${unit.id}`
  return (
    <details open={open} className="rounded-xl border border-[#CADDEE] bg-[#FBFDFF] shadow-sm">
      <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-[#1F2A36]">{unit.name}</span>
        <span className="text-xs text-[#566573] shrink-0">{unit.subunits.length} topics</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <div className="rounded-lg border border-[#DCEAF6] bg-[#F4F9FE] p-3">
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#566573] pt-2">Unit</span>
            <div className="flex items-center gap-1.5">
              <MiniBtn label={`Move unit ${unit.name} up`} disabled={isFirst} onClick={() => onMove(-1)}>Up</MiniBtn>
              <MiniBtn label={`Move unit ${unit.name} down`} disabled={isLast} onClick={() => onMove(1)}>Dn</MiniBtn>
              <MiniBtn label={`Delete unit ${unit.name}`} danger onClick={onDelete}>Del</MiniBtn>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <LabeledField id={nameId} label="Unit name">
              <input id={nameId} type="text" value={unit.name} onChange={(e) => onPatch({ name: e.target.value })} className={INPUT} />
            </LabeledField>
            <LabeledField id={descId} label="Description (opt)">
              <input id={descId} type="text" value={unit.description ?? ''} onChange={(e) => onDescription(e.target.value)} className={INPUT} />
            </LabeledField>
          </div>
        </div>

        {unit.subunits.length === 0 && (
          <p className="text-sm text-[#566573] px-1">No topics yet — add one below.</p>
        )}
        {unit.subunits.map((sub, si) => (
          <SubunitEditor
            key={sub.id} sub={sub}
            isFirst={si === 0} isLast={si === unit.subunits.length - 1}
            onPatch={(patch) => onPatchSubunit(si, patch)}
            onQuestions={(fn) => onSubunitQuestions(si, fn)}
            onMove={(dir) => onMoveSubunit(si, dir)}
            onDelete={() => onDeleteSubunit(si, sub)}
          />
        ))}

        <AddSubunitForm onAdd={onAddSubunit} />
      </div>
    </details>
  )
}

function SubunitEditor({ sub, isFirst, isLast, onPatch, onQuestions, onMove, onDelete }: {
  sub: Subunit
  isFirst: boolean
  isLast: boolean
  onPatch: (patch: Partial<Subunit>) => void
  onQuestions: (fn: (qs: Question[]) => Question[]) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const diffId = `diff-${sub.id}`
  const nameId = `sub-name-${sub.id}`
  return (
    <details className="rounded-lg border border-[#DCEAF6] bg-[#F4F9FE]">
      <summary className="cursor-pointer select-none px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-bold text-[#1F2A36]">{sub.name}</span>
        <span className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-[#EDF5FC] border border-[#CADDEE] text-[#3A4653] uppercase font-semibold">{sub.type}</span>
          <span className="text-[#566573]">{sub.questions.length} Q</span>
        </span>
      </summary>
      <div className="px-3 pb-3">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <LabeledField id={nameId} label="Topic name">
              <input id={nameId} type="text" value={sub.name} onChange={(e) => onPatch({ name: e.target.value })} className={INPUT} />
            </LabeledField>
          </div>
          <div className="flex items-center gap-1.5 pt-6">
            <MiniBtn label={`Move topic ${sub.name} up`} disabled={isFirst} onClick={() => onMove(-1)}>Up</MiniBtn>
            <MiniBtn label={`Move topic ${sub.name} down`} disabled={isLast} onClick={() => onMove(1)}>Dn</MiniBtn>
            <MiniBtn label={`Delete topic ${sub.name}`} danger onClick={onDelete}>Del</MiniBtn>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <label htmlFor={diffId} className="text-xs font-semibold uppercase tracking-wide text-[#566573]">Difficulty</label>
          <select id={diffId} value={sub.difficulty} onChange={(e) => onPatch({ difficulty: e.target.value as Difficulty })}
            className="rounded-lg bg-[#FBFDFF] border border-[#CADDEE] px-2 py-1.5 text-xs text-[#1F2A36] focus:border-[#2F6FB0] outline-none">
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="text-xs text-[#566573]">Type fixed: {sub.type}</span>
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
          className="mt-3 text-sm font-semibold px-3 py-2 rounded-lg bg-[#EDF5FC] border border-[#CADDEE] text-[#1F2A36] hover:bg-[#E1EEF9] transition-colors"
        >
          + Add {sub.type} question
        </button>
      </div>
    </details>
  )
}

function AddUnitForm({ onAdd }: { onAdd: (name: string, description: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const add = () => {
    if (name.trim() === '') return
    onAdd(name, description)
    setName('')
    setDescription('')
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-[#CADDEE] bg-[#F4F9FE] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#566573] mb-3">Add unit</h3>
      <div className="grid gap-2.5 sm:grid-cols-2 mb-3">
        <LabeledField id="new-unit-name" label="Unit name">
          <input
            id="new-unit-name" type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className={INPUT}
          />
        </LabeledField>
        <LabeledField id="new-unit-desc" label="Description (opt)">
          <input
            id="new-unit-desc" type="text" value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className={INPUT}
          />
        </LabeledField>
      </div>
      <button onClick={add} disabled={name.trim() === ''} className={`${SECONDARY_BTN} disabled:opacity-40`}>
        + Add unit
      </button>
    </div>
  )
}

function AddSubunitForm({ onAdd }: { onAdd: (name: string, type: AnswerType, difficulty: Difficulty) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AnswerType>('slider')
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const add = () => {
    if (name.trim() === '') return
    onAdd(name, type, difficulty)
    setName('')
  }
  return (
    <div className="rounded-lg border border-dashed border-[#CADDEE] bg-[#F4F9FE] p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#566573] mb-2.5">Add topic</h4>
      <div className="grid gap-2.5 sm:grid-cols-3 mb-3">
        <LabeledField id="new-sub-name" label="Topic name">
          <input
            id="new-sub-name" type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className={INPUT}
          />
        </LabeledField>
        <LabeledField id="new-sub-type" label="Answer type">
          <select id="new-sub-type" value={type} onChange={(e) => setType(e.target.value as AnswerType)} className={INPUT}>
            {ANSWER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </LabeledField>
        <LabeledField id="new-sub-diff" label="Difficulty">
          <select id="new-sub-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className={INPUT}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </LabeledField>
      </div>
      <button onClick={add} disabled={name.trim() === ''} className={`${SECONDARY_BTN} disabled:opacity-40`}>
        + Add topic
      </button>
    </div>
  )
}

function QuestionEditor({ q, index, type, subId, count, onPatch, onMove, onDelete }: {
  q: Question
  index: number
  type: AnswerType
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
        className={INPUT}
      />
    </LabeledField>
  )

  return (
    <li className="rounded-lg border border-[#DCEAF6] bg-[#FBFDFF] p-3">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <span className="text-xs font-bold pt-2" style={{ color: ACCENT }}>Q{index + 1}</span>
        <div className="flex items-center gap-1.5">
          <MiniBtn label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>Up</MiniBtn>
          <MiniBtn label={`Move question ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>Dn</MiniBtn>
          <MiniBtn label={`Delete question ${index + 1}`} danger onClick={onDelete}>Del</MiniBtn>
        </div>
      </div>
      <LabeledField id={id('prompt')} label="Prompt">
        <input id={id('prompt')} type="text" value={q.prompt} onChange={(e) => onPatch({ prompt: e.target.value })} className={INPUT} />
      </LabeledField>
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {type === 'graph' && (<>{num('x', 'X')}{num('y', 'Y')}{num('range', 'Range (opt)')}</>)}
        {type === 'slider' && (<>{num('answer', 'Answer')}{num('min', 'Min')}{num('max', 'Max')}{num('step', 'Step (opt)')}</>)}
        {type === 'fill' && (
          <div className="col-span-2">
            <LabeledField id={id('fill')} label="Answer">
              <input id={id('fill')} type="text" value={q.fill ?? ''} onChange={(e) => onPatch({ fill: e.target.value })} className={INPUT} />
            </LabeledField>
          </div>
        )}
      </div>
      <div className="mt-2.5">
        <LabeledField id={id('explain')} label="Explain (opt)">
          <input
            id={id('explain')} type="text" value={q.explain ?? ''}
            onChange={(e) => onPatch({ explain: e.target.value === '' ? undefined : e.target.value })}
            className={INPUT}
          />
        </LabeledField>
      </div>
    </li>
  )
}

function LabeledField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-[#566573] mb-1.5">{label}</label>
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
      className={`text-xs font-semibold px-2 py-1 rounded border transition-colors disabled:opacity-40 ${danger
        ? 'border-[#E7B9BC] text-[#B4232B] hover:bg-[#FBE9EA]'
        : 'border-[#CADDEE] text-[#566573] hover:bg-[#EDF5FC] hover:text-[#1F2A36]'}`}
    >
      {children}
    </button>
  )
}
