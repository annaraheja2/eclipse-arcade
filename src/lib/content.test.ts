import { describe, it, expect, afterEach, vi } from 'vitest'
import { validateCourse, draftIssue, slugify, uniqueId } from './content'
import { COURSES, type Course, type AnswerType } from '../data/subjects'

// A well-formed course as it would come back from Firestore (plain JSON plus
// the doc metadata the validator must ignore).
function firestoreDoc(): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(COURSES[0])) as Record<string, unknown>),
    updatedAt: { seconds: 1, nanoseconds: 0 },
    updatedBy: 'admin@example.com',
  }
}

// Locate the first subunit of a given answer type by [unitIndex, subunitIndex]
// so tests survive unit reordering in the bundled content.
function subunitPath(doc: Record<string, unknown>, type: AnswerType): [number, number] {
  const units = doc.units as { subunits: { type: AnswerType }[] }[]
  for (let ui = 0; ui < units.length; ui++) {
    const si = units[ui].subunits.findIndex((s) => s.type === type)
    if (si >= 0) return [ui, si]
  }
  throw new Error(`no ${type} subunit in bundled course`)
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
    const [fui, fsi] = subunitPath(badFill, 'fill')
    units = badFill.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[fui].subunits[fsi].questions[0].fill = 7
    expect(validateCourse(badFill)).toBeNull()
  })

  it('rejects non-finite numeric fields', () => {
    const bad = firestoreDoc()
    const units = bad.units as { subunits: { questions: Record<string, unknown>[] }[] }[]
    units[0].subunits[0].questions[0].answer = NaN
    expect(validateCourse(bad)).toBeNull()
  })

  it('accepts a unit with empty subunits and an optional description', () => {
    const doc = firestoreDoc()
    ;(doc.units as unknown[]).push({ id: 'empty-unit', name: 'Empty Unit', description: 'authored later', subunits: [] })
    const course = validateCourse(doc)
    expect(course).not.toBeNull()
    const unit = course!.units.find((u) => u.id === 'empty-unit')
    expect(unit).toEqual({ id: 'empty-unit', name: 'Empty Unit', description: 'authored later', subunits: [] })
  })

  it('accepts a unit with no description field at all', () => {
    const doc = firestoreDoc()
    ;(doc.units as unknown[]).push({ id: 'no-desc', name: 'No Desc', subunits: [] })
    const course = validateCourse(doc)
    expect(course!.units.find((u) => u.id === 'no-desc')).toEqual({ id: 'no-desc', name: 'No Desc', subunits: [] })
  })

  it('rejects a non-string description', () => {
    const doc = firestoreDoc()
    ;(doc.units as unknown[]).push({ id: 'bad-desc', name: 'Bad', description: 42, subunits: [] })
    expect(validateCourse(doc)).toBeNull()
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Functions & Relations')).toBe('functions-relations')
    expect(slugify('Right Triangles & Trigonometry')).toBe('right-triangles-trigonometry')
  })
  it('trims leading/trailing separators', () => {
    expect(slugify('  Vectors!  ')).toBe('vectors')
  })
  it('never returns an empty string', () => {
    expect(slugify('***')).toBe('item')
    expect(slugify('')).toBe('item')
  })
})

describe('uniqueId', () => {
  it('returns the base when free', () => {
    expect(uniqueId('circles', new Set())).toBe('circles')
  })
  it('suffixes to avoid collisions', () => {
    expect(uniqueId('circles', new Set(['circles']))).toBe('circles-2')
    expect(uniqueId('circles', new Set(['circles', 'circles-2']))).toBe('circles-3')
  })
})

describe('draftIssue', () => {
  const editedCourse = (edit: (c: Course) => void): Course => {
    const c = JSON.parse(JSON.stringify(COURSES[0])) as Course
    edit(c)
    return c
  }
  const firstOfType = (c: Course, type: AnswerType) => {
    for (const u of c.units) { const s = u.subunits.find((x) => x.type === type); if (s) return s }
    throw new Error(`no ${type} subunit in bundled course`)
  }

  it('passes the bundled course', () => {
    expect(draftIssue(COURSES[0])).toBeNull()
  })

  it('passes a course with an empty-subunit unit (structure allowed)', () => {
    const c = editedCourse((x) => { x.units.push({ id: 'blank', name: 'Blank', description: 'nothing here', subunits: [] }) })
    expect(draftIssue(c)).toBeNull()
  })

  it('flags an empty prompt with a pointable location', () => {
    const c = editedCourse((x) => { firstOfType(x, 'slider').questions[0].prompt = '  ' })
    expect(draftIssue(c)).toMatch(/Q1: prompt is empty/)
  })

  it('flags a graph question missing a coordinate', () => {
    const c = editedCourse((x) => { delete firstOfType(x, 'graph').questions[0].y })
    expect(draftIssue(c)).toMatch(/needs both x and y/)
  })

  it('flags a slider question with min >= max', () => {
    const c = editedCourse((x) => { firstOfType(x, 'slider').questions[0].min = 30 })
    expect(draftIssue(c)).toMatch(/min must be less than max/)
  })

  it('flags a slider question missing its answer', () => {
    const c = editedCourse((x) => { delete firstOfType(x, 'slider').questions[0].answer })
    expect(draftIssue(c)).toMatch(/needs answer, min, and max/)
  })

  it('flags an empty fill answer', () => {
    const c = editedCourse((x) => { firstOfType(x, 'fill').questions[0].fill = '' })
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
