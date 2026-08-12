// Curriculum shapes + the terse authoring helpers the course files use.
// Lives apart from subjects.ts so the per-course modules can import the
// helpers without a cycle (subjects.ts imports the courses, not vice versa).
//
// Everything here is re-exported from subjects.ts — app code should keep
// importing from '../data/subjects', which stays the single public surface.

export type AnswerType = 'graph' | 'slider' | 'fill'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Question {
  prompt: string
  // graph:
  x?: number; y?: number; range?: number
  // slider:
  answer?: number; min?: number; max?: number; step?: number
  // fill:
  fill?: string
  // optional one-line elaboration / method hint (shown when authored)
  explain?: string
}

export interface Subunit {
  id: string
  name: string
  difficulty: Difficulty
  type: AnswerType
  questions: Question[]
}
export interface Unit { id: string; name: string; description?: string; subunits: Subunit[] }
export interface Course { id: string; name: string; units: Unit[] }

// Authoring helpers. Which fields are set is what decides how checkAnswer
// grades a question (x -> graph, answer -> slider, else fill), so these three
// are the only sanctioned way to build one.
//
// - graph is graded within +/-0.5 on each axis; keep |x|,|y| inside `range`.
// - slider is graded within +/-`step`, so an answer must be reachable on the
//   min..max track. Integer answers keep the default 0.5 step.
// - fill is matched on trim/lowercase/collapsed-space, with a numeric-equality
//   fallback. There is NO alternate-answer support — only use it where exactly
//   one spelling is natural (a single vocabulary word). Anything numeric or
//   unit-bearing belongs on a slider instead.
export const g = (prompt: string, x: number, y: number, range = 8, explain?: string): Question => ({ prompt, x, y, range, explain })
export const s = (prompt: string, answer: number, min: number, max: number, step = 0.5, explain?: string): Question => ({ prompt, answer, min, max, step, explain })
export const f = (prompt: string, fill: string, explain?: string): Question => ({ prompt, fill, explain })

/** Lowercase hyphenated id from a display name. Mirrors lib/content's slugify,
 *  kept here so the data layer doesn't reach into lib. */
export const slug = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'

/** An outline placeholder: a named subtopic with no questions yet. It shows in
 *  the pickers (disabled) so the curriculum plan is visible before the content
 *  for it exists — the same way the team authors an outline in /admin. */
export const o = (name: string, difficulty: Difficulty = 'medium'): Subunit =>
  ({ id: slug(name), name, difficulty, type: 'fill', questions: [] })

/**
 * Appends outline placeholders to a course, unit by unit, skipping any name
 * whose id a real subunit already uses — so an outline entry never shadows
 * authored content.
 */
export function withOutline(course: Course, byUnit: Record<string, readonly string[]>): Course {
  return {
    ...course,
    units: course.units.map((unit) => {
      const names = byUnit[unit.id]
      if (!names) return unit
      const taken = new Set(unit.subunits.map((s) => s.id))
      const extra = names.filter((n) => !taken.has(slug(n))).map((n) => o(n))
      return extra.length > 0 ? { ...unit, subunits: [...unit.subunits, ...extra] } : unit
    }),
  }
}
