// Arcade content: Subject → Course → Units → Subunits. Difficulty + answer-type live on the SUBUNIT.
// This module is the single public surface for curriculum data — app code imports
// types and COURSES from here. The bundled content itself lives one file per
// course under ./courses, and admins can override any of it in /admin (Firestore,
// per-course doc); loadCourse falls back to what is bundled here.
//
// SUBJECTS are a grouping over courses and NOTHING more. A science course is the
// same Course shape, built by the same buildCourse from the same curriculum
// outline, graded by the same checkAnswer, and played by the same games — the
// subject is only how the pickers decide which courses to show together. That is
// deliberate: adding Science had to leave every cabinet untouched.

export type { AnswerType, Difficulty, Question, Subunit, Unit, Course } from './types'

import { buildCourse, type Course } from './types'
import { ALGEBRA_1 } from './courses/algebra1'
import { GEOMETRY } from './courses/geometry'
import { ALGEBRA_2 } from './courses/algebra2'
import { PRECALCULUS } from './courses/precalculus'
import { BIOLOGY } from './courses/biology'
import { CHEMISTRY } from './courses/chemistry'
import { PHYSICS } from './courses/physics'
import { CURRICULUM, PLACEMENT } from './courses/curriculum'

/** The two halves of the arcade. A course belongs to exactly one. */
export type SubjectId = 'math' | 'science'

export interface SubjectInfo {
  id: SubjectId
  name: string
  /** One line for the subject picker, so it isn't two bare words. */
  blurb: string
}

export const SUBJECTS: readonly SubjectInfo[] = [
  { id: 'math', name: 'Math', blurb: 'Algebra, geometry, and precalculus.' },
  { id: 'science', name: 'Science', blurb: 'Biology, chemistry, and physics.' },
]

// Lightweight metadata for pickers that must list courses without loading each
// one's content (which loadCourse fetches lazily).
export interface CourseInfo { id: string; name: string; subject: SubjectId }
export const COURSE_LIST: readonly CourseInfo[] = [
  { id: 'algebra-1', name: 'Algebra 1', subject: 'math' },
  { id: 'geometry', name: 'Geometry', subject: 'math' },
  { id: 'algebra-2', name: 'Algebra 2', subject: 'math' },
  { id: 'precalculus', name: 'Precalculus', subject: 'math' },
  { id: 'biology', name: 'Biology', subject: 'science' },
  { id: 'chemistry', name: 'Chemistry', subject: 'science' },
  { id: 'physics', name: 'Physics', subject: 'science' },
]

export const isSubjectId = (v: unknown): v is SubjectId => v === 'math' || v === 'science'

/** The courses in one subject, in curriculum order (gentlest first). */
export const coursesFor = (subject: SubjectId): readonly CourseInfo[] =>
  COURSE_LIST.filter((c) => c.subject === subject)

/**
 * Which subject a course belongs to. An unknown id answers 'math' rather than
 * throwing — this is called on stored preferences and router state, where a
 * stale id must degrade to the default rather than blank a picker.
 */
export const subjectOf = (courseId: string): SubjectId =>
  COURSE_LIST.find((c) => c.id === courseId)?.subject ?? 'math'

/** The course a subject opens on — its first, which is the gentlest. */
export const firstCourseOf = (subject: SubjectId): string => coursesFor(subject)[0].id

export const subjectInfo = (subject: SubjectId): SubjectInfo =>
  SUBJECTS.find((s) => s.id === subject) ?? SUBJECTS[0]

// Every course is a curriculum outline (courses/curriculum.ts) with the authored
// question sets poured into it — the curriculum owns the structure, content
// follows. Science courses go through exactly the same build.
const build = (c: Course) =>
  buildCourse(c.id, c.name, c.units, CURRICULUM[c.id], PLACEMENT[c.id])

export const COURSES: Course[] = [
  ALGEBRA_1, GEOMETRY, ALGEBRA_2, PRECALCULUS,
  BIOLOGY, CHEMISTRY, PHYSICS,
].map(build)

export function getCourse(id: string) { return COURSES.find((c) => c.id === id) }

/** The courses of one subject, with their content. */
export const coursesInSubject = (subject: SubjectId): Course[] =>
  COURSES.filter((c) => subjectOf(c.id) === subject)
