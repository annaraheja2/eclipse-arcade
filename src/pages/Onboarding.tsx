// The three things we ask a new player before the arcade opens: what to call
// them, what they're studying, and — optionally — a little about themselves.
//
// Shown once. Whether somebody has been through it is derived from the two
// answers that matter (a username and a course), not a separate flag, so a
// player who already has both is never asked again — including on a new device,
// where those come down from their account.
//
// The survey is genuinely optional: skip is a plain button, not a link hidden in
// the corner, and pressing it still records a row so "skipped" can be told apart
// from "never asked".
import { useState, type CSSProperties } from 'react'
import { coursesFor, SUBJECTS, type SubjectId } from '../data/subjects'
import { usePlayer } from '../lib/player'
import { useAuth } from '../lib/auth'
import { claimUsername, validateUsername } from '../lib/username'
import { saveSurvey, surveysAvailable } from '../lib/surveyStore'
import {
  ROLES, LEVELS, GOALS, SOURCES, EMPTY_SURVEY,
  type Survey, type Choice,
} from '../lib/survey'
import { Book } from '../icons'

const ACCENT = '#a24bff'
const BTN: CSSProperties = { background: ACCENT, color: '#12042b' }

type Step = 'name' | 'subject' | 'course' | 'survey'

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { player, setUsername, updatePreferences } = usePlayer()
  const { user } = useAuth()
  const [step, setStep] = useState<Step>(player.username ? 'subject' : 'name')

  const [name, setName] = useState(player.username ?? '')
  const [nameError, setNameError] = useState('')
  const [busy, setBusy] = useState(false)
  // Subject first, because it decides which courses the next step can offer.
  // It is recorded on the survey too, so /admin can see the split — but it is
  // not a survey QUESTION, since the player is already choosing it right here
  // and asking the same thing twice would be a worse form, not better data.
  const [subject, setSubject] = useState<SubjectId>('math')
  const [survey, setSurvey] = useState<Survey>(EMPTY_SURVEY)

  async function submitName() {
    const check = validateUsername(name)
    if (!check.ok) { setNameError(check.reason); return }
    setBusy(true)
    setNameError('')
    try {
      if (user) {
        const res = await claimUsername(user.uid, user.email, name)
        if (!res.ok) { setNameError(res.message); return }
      }
      setUsername(check.value)
      setStep('subject')
    } catch (err) {
      console.error('[eclipse-arcade] could not claim that name:', err)
      setNameError('Could not save that name — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function chooseSubject(next: SubjectId) {
    setSubject(next)
    setSurvey((s) => ({ ...s, subject: next }))
    setStep('course')
  }

  function chooseCourse(courseId: string) {
    updatePreferences({ preferredCourseId: courseId })
    // Nothing to ask if there is nowhere to record it.
    if (!surveysAvailable() || !user) { onDone(); return }
    setStep('survey')
  }

  async function finishSurvey(skipped: boolean) {
    setBusy(true)
    try {
      // `subject` rides along even on a skip: they really did choose it a
      // moment ago, so recording it is honest, and it is the one answer the
      // admin breakdown can always count on.
      if (user) await saveSurvey(user.uid, { ...survey, subject, skipped })
    } catch (err) {
      // Never trap a player behind an optional question.
      console.error('[eclipse-arcade] could not save the survey:', err)
    } finally {
      setBusy(false)
      onDone()
    }
  }

  return (
    <div className="min-h-screen relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-lg mx-auto px-5 py-10">
        <div className="text-center mb-8">
          <div className="inline-grid place-items-center w-12 h-12 rounded-2xl mb-3"
            style={{ background: 'rgba(162,75,255,0.15)', color: ACCENT }}>
            <Book width={22} height={22} />
          </div>
          <h1 className="font-pixel text-[15px]" style={{ color: ACCENT }}>WELCOME</h1>
          <p className="mt-2 text-sm text-white/60">
            {step === 'name' && 'Pick a name other players will see.'}
            {step === 'subject' && 'Which subject do you want to focus on?'}
            {step === 'course' && 'And which course are you working on?'}
            {step === 'survey' && 'Last thing — and you can skip it.'}
          </p>
        </div>

        <Progress step={step} />

        {step === 'name' && (
          <section className="mt-7">
            <label htmlFor="ob-name" className="block font-pixel text-[10px] text-white/60 mb-2">
              YOUR USERNAME
            </label>
            <input
              id="ob-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitName() }}
              autoFocus
              maxLength={20}
              aria-describedby="ob-name-help"
              aria-invalid={nameError ? true : undefined}
              className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white outline-none focus:border-neon-purple"
              placeholder="e.g. NOVA"
            />
            <p id="ob-name-help" className="mt-2 text-xs text-white/45">
              3–20 characters. Letters, numbers and underscores, starting with a letter.
            </p>
            {nameError && <p role="alert" className="mt-2 text-sm text-[#ff9dbd]">{nameError}</p>}
            <button onClick={() => void submitName()} disabled={busy || name.trim().length === 0}
              className="mt-5 w-full font-pixel text-[11px] px-5 py-3.5 rounded-xl disabled:opacity-40" style={BTN}>
              {busy ? 'CHECKING…' : 'CONTINUE'}
            </button>
          </section>
        )}

        {step === 'subject' && (
          <section className="mt-7 grid gap-2">
            {SUBJECTS.map((s) => (
              <button key={s.id} onClick={() => chooseSubject(s.id)}
                className="text-left rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 hover:border-neon-purple/60 transition">
                <span className="block font-sans font-semibold text-white/90">{s.name}</span>
                <span className="block text-xs text-white/55 mt-0.5">{s.blurb}</span>
              </button>
            ))}
            <p className="mt-1 text-xs text-white/45 text-center">
              Every game carries both — this is just where you start.
            </p>
          </section>
        )}

        {step === 'course' && (
          <section className="mt-7 grid gap-2">
            {coursesFor(subject).map((c) => (
              <button key={c.id} onClick={() => chooseCourse(c.id)}
                className="text-left rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 hover:border-neon-purple/60 transition">
                <span className="block font-sans font-semibold text-white/90">{c.name}</span>
              </button>
            ))}
            <button onClick={() => setStep('subject')}
              className="mt-1 text-xs text-white/50 hover:text-white/80 underline underline-offset-2">
              Back to subjects
            </button>
            <p className="text-xs text-white/45 text-center">
              You can play any course — this is just what opens by default.
            </p>
          </section>
        )}

        {step === 'survey' && (
          <section className="mt-7 grid gap-6">
            <Question label="I'm…" choices={ROLES}
              value={survey.role} onPick={(v) => setSurvey((s) => ({ ...s, role: v }))} />
            <Question label="School level" choices={LEVELS}
              value={survey.level} onPick={(v) => setSurvey((s) => ({ ...s, level: v }))} />
            <Question label="I'm here to…" choices={GOALS}
              value={survey.goal} onPick={(v) => setSurvey((s) => ({ ...s, goal: v }))} />
            <Question label="How did you hear about us?" choices={SOURCES}
              value={survey.source} onPick={(v) => setSurvey((s) => ({ ...s, source: v }))} />

            <div className="flex flex-wrap gap-3">
              <button onClick={() => void finishSurvey(false)} disabled={busy}
                className="flex-1 font-pixel text-[11px] px-5 py-3.5 rounded-xl disabled:opacity-40" style={BTN}>
                {busy ? 'SAVING…' : 'DONE'}
              </button>
              <button onClick={() => void finishSurvey(true)} disabled={busy}
                className="font-pixel text-[11px] px-5 py-3.5 rounded-xl bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-40">
                SKIP
              </button>
            </div>
            <p className="text-xs text-white/45 text-center -mt-3">
              Every question is optional, and none of it changes how you play.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

function Progress({ step }: { step: Step }) {
  const order: Step[] = ['name', 'subject', 'course', 'survey']
  const at = order.indexOf(step)
  return (
    <ol className="flex gap-2" aria-label={`Step ${at + 1} of ${order.length}`}>
      {order.map((s, i) => (
        <li key={s} aria-hidden className="h-1 flex-1 rounded-full overflow-hidden bg-white/10">
          <span className="block h-full rounded-full transition-all"
            style={{ width: i <= at ? '100%' : '0%', background: ACCENT }} />
        </li>
      ))}
    </ol>
  )
}

function Question<T extends string>({ label, choices, value, onPick }: {
  label: string
  choices: readonly Choice<T>[]
  value: T | null
  onPick: (v: T) => void
}) {
  return (
    <fieldset>
      <legend className="font-pixel text-[10px] text-white/60 mb-2">{label.toUpperCase()}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => {
          const picked = value === c.value
          return (
            <button key={c.value} type="button" onClick={() => onPick(c.value)}
              aria-pressed={picked}
              className={`text-sm px-3.5 py-2 rounded-lg border transition ${
                picked
                  ? 'border-transparent font-semibold'
                  : 'border-white/15 bg-white/[0.03] text-white/80 hover:bg-white/[0.07]'
              }`}
              style={picked ? BTN : undefined}>
              {c.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
