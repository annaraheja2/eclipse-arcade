import { describe, it, expect } from 'vitest'
import {
  SUBJECTS, COURSE_LIST, COURSES, coursesFor, subjectOf, firstCourseOf,
  isSubjectId, coursesInSubject, subjectInfo, type SubjectId,
} from './subjects'
import { SUBJECT_CHOICES } from '../lib/survey'

const IDS: SubjectId[] = ['math', 'science']

describe('subjects', () => {
  it('groups every course under exactly one subject', () => {
    for (const c of COURSE_LIST) {
      expect(IDS, `${c.id} has an unknown subject`).toContain(c.subject)
    }
    const grouped = IDS.flatMap((s) => coursesFor(s).map((c) => c.id))
    expect(grouped.slice().sort()).toEqual(COURSE_LIST.map((c) => c.id).slice().sort())
    expect(grouped.length).toBe(COURSE_LIST.length)
  })

  it('leaves no subject empty, so a picker can never open on nothing', () => {
    for (const s of SUBJECTS) expect(coursesFor(s.id).length, `${s.id} has no courses`).toBeGreaterThan(0)
  })

  it('carries the science courses the arcade advertises', () => {
    expect(coursesFor('science').map((c) => c.name)).toEqual(['Biology', 'Chemistry', 'Physics'])
  })

  it('gives every science course real content, like the math ones', () => {
    for (const c of coursesInSubject('science')) {
      const n = c.units.reduce((t, u) => t + u.subunits.reduce((m, s) => m + s.questions.length, 0), 0)
      expect(n, `${c.id} has no questions`).toBeGreaterThan(0)
    }
  })

  it('answers a stale or unknown course id with the default subject', () => {
    // Called on stored preferences and router state — it must degrade, not throw.
    expect(subjectOf('no-such-course')).toBe('math')
    expect(subjectOf('')).toBe('math')
  })

  it('maps each course to the subject it is listed under', () => {
    for (const c of COURSE_LIST) expect(subjectOf(c.id)).toBe(c.subject)
  })

  it('opens each subject on a course that really is in it', () => {
    for (const s of IDS) expect(subjectOf(firstCourseOf(s))).toBe(s)
  })

  it('narrows a subject id', () => {
    expect(isSubjectId('math')).toBe(true)
    expect(isSubjectId('science')).toBe(true)
    expect(isSubjectId('history')).toBe(false)
    expect(isSubjectId(null)).toBe(false)
    expect(isSubjectId(undefined)).toBe(false)
  })

  it('falls back to a real subject rather than undefined', () => {
    expect(SUBJECTS.map((s) => subjectInfo(s.id).id)).toEqual(SUBJECTS.map((s) => s.id))
  })

  it('keeps COURSES and COURSE_LIST in the same subject order', () => {
    // COURSES is what /admin and loadCourse walk; COURSE_LIST is what pickers
    // walk. If they disagreed, a picker could offer a course that never builds.
    expect(COURSES.map((c) => c.id)).toEqual(COURSE_LIST.map((c) => c.id))
  })

  it('keeps the survey subject options in step with the real subjects', () => {
    // lib/survey.ts re-declares these rather than importing, to stay dependency
    // free — so this is the seam that stops the two drifting apart.
    expect(SUBJECT_CHOICES.map((c) => c.value)).toEqual(SUBJECTS.map((s) => s.id))
  })
})
