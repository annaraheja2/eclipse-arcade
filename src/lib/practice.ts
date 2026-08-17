// Practice mode — the study tab. A player picks a course, a unit, and the
// subtopics they want, then works through those questions one at a time with no
// clock, no score, and the answer revealed when they miss.
//
// The questions are whatever admins authored for that subtopic: the page calls
// loadCourse, so the Firestore copy merged over the bundle is exactly what shows
// up here. Practice carries no content of its own.
//
// Pure helpers only — pages/Practice.tsx owns the React state and the fetch.
import type { Course, Question, Unit } from '../data/subjects'
import { taggedPool, type TaggedQuestion } from './summary'

/** What the practice queue holds: a question plus the subtopic it came from,
 *  so the end-of-session summary can say WHICH topic went badly. */
export type PracticeItem = TaggedQuestion

/** Questions authored under `unitId` for the selected subtopics, in curriculum order. */
export function poolFor(course: Course, unitId: string, subunitIds: ReadonlySet<string>): PracticeItem[] {
  const unit = course.units.find((u) => u.id === unitId)
  if (!unit) return []
  return taggedPool(unit.subunits.filter((s) => subunitIds.has(s.id)))
}

/** Total authored questions in a unit. 0 means it's still an outline placeholder. */
export function unitQuestionCount(unit: Unit): number {
  return unit.subunits.reduce((n, s) => n + s.questions.length, 0)
}

/** Fisher–Yates. `rng` is injected so ordering is testable. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A pass through the selected questions in random order. Practice reshuffles on
 * wrap rather than drawing at random each time, so a player sees every question
 * once before any of them comes back.
 */
export interface Queue<T> { items: readonly T[]; index: number }

export function startQueue<T>(pool: readonly T[], rng: () => number): Queue<T> {
  return { items: shuffle(pool, rng), index: 0 }
}

export function current<T>(q: Queue<T>): T | undefined {
  return q.items[q.index]
}

/**
 * Steps to the next question, reshuffling for a fresh pass at the end. The new
 * pass never opens on the question just answered (it would read as a bug), so
 * the head is swapped away when the shuffle lands there.
 */
export function advance<T>(q: Queue<T>, rng: () => number): Queue<T> {
  if (q.index + 1 < q.items.length) return { ...q, index: q.index + 1 }
  const last = q.items[q.index]
  const items = shuffle(q.items, rng)
  if (items.length > 1 && items[0] === last) {
    ;[items[0], items[1]] = [items[1], items[0]]
  }
  return { items, index: 0 }
}

/**
 * The correct answer as text, for the line shown after a miss. Dispatches on the
 * same fields checkAnswer grades on (x → graph, answer → slider, else fill) —
 * these two must agree, or practice would reveal an answer it didn't accept.
 */
export function answerText(q: Question): string {
  if (q.x !== undefined) return `(${q.x}, ${q.y ?? 0})`
  if (q.answer !== undefined) return `${q.answer}`
  return q.fill ?? ''
}
