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

/** Questions authored under `unitId` for the selected subtopics, in curriculum order. */
export function poolFor(course: Course, unitId: string, subunitIds: ReadonlySet<string>): Question[] {
  const unit = course.units.find((u) => u.id === unitId)
  if (!unit) return []
  return unit.subunits.filter((s) => subunitIds.has(s.id)).flatMap((s) => s.questions)
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
export interface Queue { questions: readonly Question[]; index: number }

export function startQueue(pool: readonly Question[], rng: () => number): Queue {
  return { questions: shuffle(pool, rng), index: 0 }
}

export function current(q: Queue): Question | undefined {
  return q.questions[q.index]
}

/**
 * Steps to the next question, reshuffling for a fresh pass at the end. The new
 * pass never opens on the question just answered (it would read as a bug), so
 * the head is swapped away when the shuffle lands there.
 */
export function advance(q: Queue, rng: () => number): Queue {
  if (q.index + 1 < q.questions.length) return { ...q, index: q.index + 1 }
  const last = q.questions[q.index]
  const questions = shuffle(q.questions, rng)
  if (questions.length > 1 && questions[0] === last) {
    ;[questions[0], questions[1]] = [questions[1], questions[0]]
  }
  return { questions, index: 0 }
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
