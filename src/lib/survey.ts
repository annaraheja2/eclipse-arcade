// The optional questions a new player is asked once, and the counting the
// admin screen does with the answers.
//
// Every option lives here rather than in the form, so the labels a player reads
// and the labels an admin reads are the same strings — a breakdown that says
// "middle" while the form said "Middle school" is the sort of drift that makes
// the numbers quietly untrustworthy.
//
// Answering is optional and skipping is a first-class outcome, recorded rather
// than left absent: "3 of 40 skipped" is information, "37 documents exist" is a
// guess about the other three.
//
// Pure. lib/surveyStore.ts talks to Firestore.

export interface Choice<T extends string> { value: T; label: string }

export type Role = 'student' | 'teacher' | 'parent' | 'other'
export const ROLES: readonly Choice<Role>[] = [
  { value: 'student', label: 'A student' },
  { value: 'teacher', label: 'A teacher' },
  { value: 'parent', label: 'A parent' },
  { value: 'other', label: 'Someone else' },
]

export type Level = 'elementary' | 'middle' | 'high' | 'college' | 'adult'
export const LEVELS: readonly Choice<Level>[] = [
  { value: 'elementary', label: 'Elementary school' },
  { value: 'middle', label: 'Middle school' },
  { value: 'high', label: 'High school' },
  { value: 'college', label: 'College' },
  { value: 'adult', label: 'Out of school' },
]

export type Goal = 'catch-up' | 'keep-up' | 'get-ahead' | 'test-prep' | 'fun'
export const GOALS: readonly Choice<Goal>[] = [
  { value: 'catch-up', label: 'Catch up on things I missed' },
  { value: 'keep-up', label: 'Keep up with class' },
  { value: 'get-ahead', label: 'Get ahead' },
  { value: 'test-prep', label: 'Prepare for a test' },
  { value: 'fun', label: 'Just for fun' },
]

export type Source = 'teacher' | 'friend' | 'family' | 'search' | 'other'
export const SOURCES: readonly Choice<Source>[] = [
  { value: 'teacher', label: 'A teacher' },
  { value: 'friend', label: 'A friend' },
  { value: 'family', label: 'Family' },
  { value: 'search', label: 'Found it online' },
  { value: 'other', label: 'Somewhere else' },
]

/** One player's answers. Every question may be left blank. */
export interface Survey {
  role: Role | null
  level: Level | null
  goal: Goal | null
  source: Source | null
  /** True when they pressed skip rather than answering. */
  skipped: boolean
  createdAtMs: number
}

/** A survey with a uid attached, which is how the admin screen sees them. */
export interface SurveyRow extends Survey { uid: string }

export const EMPTY_SURVEY: Survey = {
  role: null, level: null, goal: null, source: null, skipped: false, createdAtMs: 0,
}

const valueOf = <T extends string>(choices: readonly Choice<T>[], v: unknown): T | null =>
  typeof v === 'string' && choices.some((c) => c.value === v) ? (v as T) : null

/** Narrows an untrusted survey document. Unknown answers become blanks rather
 *  than rejecting the whole row — a stale option shouldn't hide a response. */
export function toSurvey(uid: string, data: unknown): SurveyRow | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const createdAt = d.createdAt
  const createdAtMs = typeof createdAt === 'object' && createdAt !== null
    && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function'
    ? (createdAt as { toMillis: () => number }).toMillis()
    : 0
  return {
    uid,
    role: valueOf(ROLES, d.role),
    level: valueOf(LEVELS, d.level),
    goal: valueOf(GOALS, d.goal),
    source: valueOf(SOURCES, d.source),
    skipped: d.skipped === true,
    createdAtMs,
  }
}

/** Plain JSON for Firestore. Firestore rejects undefined, so blanks are null. */
export function surveyData(s: Survey): Record<string, unknown> {
  return {
    role: s.role, level: s.level, goal: s.goal, source: s.source, skipped: s.skipped,
  }
}

/** True when there is anything to report — a skip with no answers is not. */
export function hasAnswers(s: Survey): boolean {
  return s.role !== null || s.level !== null || s.goal !== null || s.source !== null
}

// ---------------------------------------------------------------------------
// Counting, for the admin screen
// ---------------------------------------------------------------------------

export interface Count { value: string; label: string; count: number; pct: number }

/**
 * How many people picked each option, biggest first.
 *
 * The percentage is of people who ANSWERED THIS QUESTION, not of everyone —
 * with each question optional, dividing by the total would quietly understate
 * every option and make a well-answered question look unpopular. `answered` is
 * reported alongside so the denominator is never a guess.
 */
export function tally<T extends string>(
  rows: readonly SurveyRow[], field: keyof Survey, choices: readonly Choice<T>[],
): { counts: Count[]; answered: number } {
  const counts = new Map<string, number>()
  let answered = 0
  for (const row of rows) {
    const v = row[field]
    if (typeof v !== 'string') continue
    if (!choices.some((c) => c.value === v)) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
    answered += 1
  }
  const out: Count[] = choices
    .map((c) => ({
      value: c.value,
      label: c.label,
      count: counts.get(c.value) ?? 0,
      pct: answered === 0 ? 0 : Math.round(((counts.get(c.value) ?? 0) / answered) * 100),
    }))
    .filter((c) => c.count > 0)
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { counts: out, answered }
}

export interface SurveySummary {
  responses: number
  skipped: number
  role: { counts: Count[]; answered: number }
  level: { counts: Count[]; answered: number }
  goal: { counts: Count[]; answered: number }
  source: { counts: Count[]; answered: number }
}

/** Everything the admin screen shows, from the rows it was given. */
export function summarise(rows: readonly SurveyRow[]): SurveySummary {
  return {
    responses: rows.length,
    skipped: rows.filter((r) => r.skipped && !hasAnswers(r)).length,
    role: tally(rows, 'role', ROLES),
    level: tally(rows, 'level', LEVELS),
    goal: tally(rows, 'goal', GOALS),
    source: tally(rows, 'source', SOURCES),
  }
}
