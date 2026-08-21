// Arcade content: Course → Units → Subunits. Difficulty + answer-type live on the SUBUNIT.
// This module is the single public surface for curriculum data — app code imports
// types and COURSES from here. The bundled content itself lives one file per
// course under ./courses, and admins can override any of it in /admin (Firestore,
// per-course doc); loadCourse falls back to what is bundled here.

export type { AnswerType, Difficulty, Question, Subunit, Unit, Course } from './types'

import { buildCourse, type Course } from './types'
import { ALGEBRA_1 } from './courses/algebra1'
import { GEOMETRY } from './courses/geometry'
import { ALGEBRA_2 } from './courses/algebra2'
import { PRECALCULUS } from './courses/precalculus'
import { CURRICULUM, PLACEMENT } from './courses/curriculum'

// Lightweight metadata for pickers that must list courses without loading each
// one's content (which loadCourse fetches lazily).
export interface CourseInfo { id: string; name: string }
export const COURSE_LIST: readonly CourseInfo[] = [
  { id: 'algebra-1', name: 'Algebra 1' },
  { id: 'geometry', name: 'Geometry' },
  { id: 'algebra-2', name: 'Algebra 2' },
  { id: 'precalculus', name: 'Precalculus' },
]

// Every course is the team's curriculum outline (courses/curriculum.ts) with
// the authored question sets poured into it — the curriculum owns the
// structure, content follows.
const build = (c: Course) =>
  buildCourse(c.id, c.name, c.units, CURRICULUM[c.id], PLACEMENT[c.id])

export const COURSES: Course[] = [ALGEBRA_1, GEOMETRY, ALGEBRA_2, PRECALCULUS].map(build)

export function getCourse(id: string) { return COURSES.find((c) => c.id === id) }
