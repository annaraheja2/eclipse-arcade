// What new players told us about themselves, for the admin screen.
//
// Styled in /admin's calm palette rather than the arcade's neon, because this is
// a back-office readout and sits beside the content editor.
//
// Every percentage is of the people who answered THAT question, and the count it
// divides by is printed next to it. With each question optional, a single
// "of all sign-ups" denominator would quietly understate every option — and a
// number whose denominator you can't see is a number nobody should act on.
import { useEffect, useState } from 'react'
import { loadAllSurveys } from '../lib/surveyStore'
import {
  summarise, ROLES, LEVELS, GOALS, SOURCES,
  type SurveyRow, type SurveySummary, type Count,
} from '../lib/survey'

export default function SurveyReport() {
  const [rows, setRows] = useState<SurveyRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadAllSurveys()
      .then((r) => { if (!cancelled) setRows(r) })
      .catch((err) => {
        console.error('[eclipse-arcade] could not load sign-ups:', err)
        if (!cancelled) {
          setError('Could not load sign-ups. If this account is an admin, the surveys rules may not be published yet.')
        }
      })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return <p role="alert" className="text-sm text-[#B4232B] py-8">{error}</p>
  }
  if (!rows) {
    return <p className="text-sm text-[#566573] py-8">Loading sign-ups…</p>
  }
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-semibold text-[#1F2A36]">No sign-ups yet</p>
        <p className="mt-1 text-sm text-[#566573]">
          Answers appear here as new players finish the welcome screens.
        </p>
      </div>
    )
  }

  const s: SurveySummary = summarise(rows)

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Sign-ups" value={s.responses} />
        <Stat label="Skipped the survey" value={s.skipped}
          note={s.responses > 0 ? `${Math.round((s.skipped / s.responses) * 100)}% of sign-ups` : undefined} />
      </div>

      <Breakdown title="Who they are" answered={s.role.answered} counts={s.role.counts} total={ROLES.length} />
      <Breakdown title="School level" answered={s.level.answered} counts={s.level.counts} total={LEVELS.length} />
      <Breakdown title="What they came for" answered={s.goal.answered} counts={s.goal.counts} total={GOALS.length} />
      <Breakdown title="How they found us" answered={s.source.answered} counts={s.source.counts} total={SOURCES.length} />
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-[#CADDEE] bg-[#FBFDFF] px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-[#1F2A36]">{value}</div>
      <div className="text-xs font-semibold text-[#566573]">{label}</div>
      {note && <div className="mt-0.5 text-xs text-[#8A96A3]">{note}</div>}
    </div>
  )
}

function Breakdown({ title, answered, counts, total }: {
  title: string; answered: number; counts: Count[]; total: number
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-bold text-[#1F2A36]">{title}</h3>
        <span className="text-xs text-[#8A96A3] tabular-nums">
          {answered} answered
        </span>
      </div>
      {counts.length === 0 ? (
        <p className="text-sm text-[#8A96A3]">Nobody answered this one yet.</p>
      ) : (
        <ul className="grid gap-1.5">
          {counts.map((c) => (
            <li key={c.value} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-[#1F2A36]">{c.label}</span>
              <span aria-hidden className="w-28 h-1.5 rounded-full bg-[#EDF5FC] overflow-hidden shrink-0">
                <span className="block h-full rounded-full bg-[#3E7BC4]" style={{ width: `${c.pct}%` }} />
              </span>
              <span className="shrink-0 w-20 text-right text-xs tabular-nums text-[#566573]">
                {c.count} · {c.pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
      {counts.length < total && counts.length > 0 && (
        <p className="mt-1.5 text-xs text-[#8A96A3]">
          Options nobody picked are left out.
        </p>
      )}
    </section>
  )
}
