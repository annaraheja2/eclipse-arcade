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
  description?: string // the curriculum one-liner for this subtopic
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
 *  for it exists. */
export const o = (name: string, description: string, difficulty: Difficulty = 'medium'): Subunit =>
  ({ id: slug(name), name, description, difficulty, type: 'fill', questions: [] })

interface OutlineTopicLike { name: string; description: string }
interface OutlineUnitLike { id: string; name: string; description: string; topics: readonly OutlineTopicLike[] }

/**
 * Builds a course from the curriculum outline, pouring the authored question
 * sets into it: each unit gets the subunits `placement` assigns to it (in their
 * original order), then a placeholder for every planned topic not already
 * covered. The curriculum decides the structure; content follows it.
 *
 * A subunit whose id is missing from `placement` would be silently dropped, so
 * callers must map every one — courses.test.ts proves none is lost.
 */
export function buildCourse(
  id: string,
  name: string,
  content: readonly Unit[],
  outline: readonly OutlineUnitLike[],
  placement: Record<string, string>,
): Course {
  const authored = content.flatMap((u) => u.subunits)
  return {
    id,
    name,
    units: outline.map((unit) => {
      const here = authored.filter((s) => (placement[s.id] ?? '').split('#')[0] === unit.id)
      const target = (s: Subunit) => (placement[s.id] ?? '').split('#')[1]
      // Sets aimed at a named topic are poured into it, in curriculum order;
      // the rest keep their own name and sit at the front of the unit.
      const loose = here.filter((s) => !target(s))
      const subunits: Subunit[] = [...loose]
      for (const topic of unit.topics) {
        const into = here.filter((s) => target(s) === topic.name)
        if (into.length === 0) { subunits.push(o(topic.name, topic.description)); continue }
        subunits.push({
          id: slug(topic.name),
          name: topic.name,
          description: topic.description,
          difficulty: into[0].difficulty,
          type: into[0].type,
          questions: into.flatMap((s) => s.questions),
        })
      }
      return { id: unit.id, name: unit.name, description: unit.description, subunits }
    }),
  }
}
