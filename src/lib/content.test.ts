import { describe, it, expect, afterEach, vi } from 'vitest'
import { validateCourse, draftIssue } from './content'
import { COURSES, type Course } from '../data/subjects'

// A well-formed course as it would come back from Firestore (plain JSON plus
// the doc metadata the validator must ignore).
function firestoreDoc(): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(COURSES[0])) as Record<string, unknown>),
    updatedAt: { seconds: 1, nanoseconds: 0 },
    updatedBy: 'admin@example.com',
  }
}

describe('validateCourse', () => {
  it('accepts the bundled course round-tripped through JSON', () => {
    expect(validateCourse(JSON.parse(JSON.stringify(COURSES[0])))).toEqual(COURSES[0])
  })

  it('strips doc metadata and unknown fields from the result', () => {
    const course = validateCourse(firestoreDoc())
    expect(course).toEqual(COURSES[0])
    expect(course).not.toHaveProperty('updatedAt')
    expect(course).not.toHaveProperty('updatedBy')
  })

  it('rejects non-objects', () => {
    expect(validateCourse(null)).toBeNull()
    expect(validateCourse('algebra-1')).toBeNull()
    expect(validateCourse([COURSES[0]])).toBeNull()
  })

  it('rejects a course missing required fields', () => {
    const doc = firestoreDoc()
    delete doc.name
    expect(validateCourse(doc)).toBeNull()
    expect(validateCourse({ id: 'x', name: 'X' })).toBeNull() // no units
  })

  it('rejects wrong kinds on subunit difficulty/type', () => {
    const bad = firestoreDoc()
    const units = bad.units as { subunits: Record<string, unknown>[] }[]
    units[0].subunits[0].difficulty = 'extreme'
    expect(validateCourse(bad)).toBeNull()

    const bad2 = firestoreDoc()
    const units2 = bad2.units as { subunits: Record<string, unknown>[] }[]
    units2[0].subunits[0].type = 'essay'
    expect(validateCourse(bad2)).toBeNull()
  })

  it('rejects non-array questions', () => {
    const bad = firestoreDoc()
    const units = bad.units as { subunits: Record<string, unknown>[] }[]
    units[0].subunits[0].questions = { 0: { prompt: 'hi' } }
    expect(validateCourse(bad)).toBeNull()
  })

  it('rejects a question with a wrong-typed field', () => {
    const badPrompt = firestoreDoc()
    let units = badPrompt.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[0].subunits[0].questions[0].prompt = 42
    expect(validateCourse(badPrompt)).toBeNull()

    const badAnswer = firestoreDoc()
    units = badAnswer.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[0].subunits[0].questions[0].answer = '7'
    expect(validateCourse(badAnswer)).toBeNull()

    const badFill = firestoreDoc()
    units = badFill.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[2].subunits[0].questions[0].fill = 7
    expect(validateCourse(badFill)).toBeNull()
  })

  it('rejects non-finite numeric fields', () => {
    const bad = firestoreDoc()
    const units = bad.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[0].subunits[0].questions[0].answer = NaN
    expect(validateCourse(bad)).toBeNull()
  })
})

describe('draftIssue', () => {
  const editedCourse = (edit: (c: Course) => void): Course => {
    const c = JSON.parse(JSON.stringify(COURSES[0])) as Course
    edit(c)
    return c
  }

  it('passes the bundled course', () => {
    expect(draftIssue(COURSES[0])).toBeNull()
  })

  it('flags an empty prompt with a pointable location', () => {
    const c = editedCourse((x) => { x.units[0].subunits[0].questions[0].prompt = '  ' })
    expect(draftIssue(c)).toMatch(/One-Step — Q1: prompt is empty/)
  })

  it('flags a graph question missing a coordinate', () => {
    const c = editedCourse((x) => { delete x.units[1].subunits[0].questions[0].y })
    expect(draftIssue(c)).toMatch(/needs both x and y/)
  })

  it('flags a slider question with min >= max', () => {
    const c = editedCourse((x) => { x.units[0].subunits[0].questions[0].min = 30 })
    expect(draftIssue(c)).toMatch(/min must be less than max/)
  })

  it('flags a slider question missing its answer', () => {
    const c = editedCourse((x) => { delete x.units[0].subunits[0].questions[0].answer })
    expect(draftIssue(c)).toMatch(/needs answer, min, and max/)
  })

  it('flags an empty fill answer', () => {
    const c = editedCourse((x) => { x.units[2].subunits[0].questions[0].fill = '' })
    expect(draftIssue(c)).toMatch(/fill answer is empty/)
  })
})

// loadCourse contract in unconfigured mode: resolves to the bundled course
// without touching the SDK, and unknown ids fail loudly (programmer error).
// Same env-stub + fresh-import pattern as firebase.test.ts.
const FIREBASE_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

function importUnconfigured() {
  vi.resetModules()
  for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
  return import('./content')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('loadCourse (unconfigured)', () => {
  it('resolves to the bundled course', async () => {
    const { loadCourse } = await importUnconfigured()
    await expect(loadCourse(COURSES[0].id)).resolves.toEqual(COURSES[0])
  })

  it('rejects an unknown course id', async () => {
    const { loadCourse } = await importUnconfigured()
    await expect(loadCourse('no-such-course')).rejects.toThrow(/Unknown course id/)
  })
})
