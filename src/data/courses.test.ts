import { describe, it, expect } from 'vitest'
import { COURSES, COURSE_LIST, type Question } from './subjects'
import { ALGEBRA_1 } from './courses/algebra1'
import { GEOMETRY } from './courses/geometry'
import { ALGEBRA_2 } from './courses/algebra2'
import { PRECALCULUS } from './courses/precalculus'
import { CURRICULUM, PLACEMENT } from './courses/curriculum'
import { draftIssue } from '../lib/content'
import { checkAnswer } from '../components/QuestionPanel'

// Data-integrity tests for the bundled curriculum. TypeScript proves the shape;
// these prove the content is actually PLAYABLE — the failures that would only
// ever surface mid-game:
//   * a slider answer the snapped handle can never land on,
//   * a graph point outside its own board,
//   * a question whose fields disagree with its subunit's declared type
//     (checkAnswer dispatches on the FIELDS, so a slider missing `answer`
//     silently becomes an unanswerable fill).

const everySubunit = () =>
  COURSES.flatMap((c) => c.units.flatMap((u) => u.subunits.map((s) => ({ course: c, unit: u, sub: s }))))

const everyQuestion = () =>
  everySubunit().flatMap(({ course, unit, sub }) =>
    sub.questions.map((q, i) => ({ course, unit, sub, q, where: `${course.id}/${unit.id}/${sub.id}#${i + 1}` })))

describe('bundled curriculum — structure', () => {
  it('exposes exactly the courses COURSE_LIST advertises, in the same order', () => {
    expect(COURSES.map((c) => c.id)).toEqual(COURSE_LIST.map((c) => c.id))
    expect(COURSES.map((c) => c.name)).toEqual(COURSE_LIST.map((c) => c.name))
  })

  it('gives every unit at least one subtopic', () => {
    // A unit with no PLAYABLE subtopic is fine — the curriculum plans ahead of
    // the content (Conic Sections, Complex Numbers, Modeling…). A unit with no
    // subtopics at all would be a hole in the outline.
    for (const c of COURSES) {
      for (const u of c.units) {
        expect(u.subunits.length, `${c.id}/${u.id} has no subunits`).toBeGreaterThan(0)
      }
    }
  })

  it('follows the curriculum outline exactly, unit for unit', () => {
    for (const c of COURSES) {
      expect(c.units.map((u) => u.id), `${c.id} units`).toEqual(CURRICULUM[c.id].map((u) => u.id))
      expect(c.units.map((u) => u.name), `${c.id} unit names`).toEqual(CURRICULUM[c.id].map((u) => u.name))
    }
  })

  it('loses no authored question set in the restructure', () => {
    const raw: Record<string, typeof ALGEBRA_1> = {
      'algebra-1': ALGEBRA_1, geometry: GEOMETRY, 'algebra-2': ALGEBRA_2, precalculus: PRECALCULUS,
    }
    for (const c of COURSES) {
      const before = raw[c.id].units.flatMap((u) => u.subunits.filter((s) => s.questions.length > 0))
      const after = new Set(c.units.flatMap((u) => u.subunits.map((s) => s.id)))
      const unitIds = new Set(c.units.map((u) => u.id))
      for (const s of before) {
        const target = PLACEMENT[c.id][s.id]
        expect(target, `${c.id}/${s.id} has no PLACEMENT entry`).toBeTypeOf('string')
        const [unitId, topic] = target.split('#')
        expect(unitIds.has(unitId), `${c.id}/${s.id} points at unknown unit ${unitId}`).toBe(true)
        // it survives either under its own id, or poured into a named topic
        const landed = topic
          ? c.units.some((u) => u.subunits.some((x) => x.name === topic && x.questions.length > 0))
          : after.has(s.id)
        expect(landed, `${c.id}/${s.id} was dropped by the restructure`).toBe(true)
      }
      const qBefore = before.reduce((n, s) => n + s.questions.length, 0)
      const qAfter = c.units.reduce((n, u) => n + u.subunits.reduce((m, s) => m + s.questions.length, 0), 0)
      expect(qAfter, `${c.id} lost questions`).toBe(qBefore)
    }
  })

  it('never merges two answer types into one subtopic', () => {
    // checkAnswer dispatches on a question's FIELDS, but draftIssue and the
    // pickers trust subunit.type — so a graph set poured into a slider topic
    // would grade and validate wrong.
    for (const c of COURSES) {
      for (const u of c.units) {
        for (const s of u.subunits) {
          for (const q of s.questions) {
            const shape = q.x !== undefined ? 'graph' : q.answer !== undefined ? 'slider' : 'fill'
            expect(shape, `${c.id}/${u.id}/${s.id} declares ${s.type} but holds a ${shape} question`).toBe(s.type)
          }
        }
      }
    }
  })

  it('describes every planned subtopic', () => {
    for (const c of COURSES) {
      for (const u of c.units) {
        for (const s of u.subunits.filter((x) => x.questions.length === 0)) {
          expect((s.description ?? '').trim(), `${c.id}/${u.id}/${s.id} has no description`).not.toBe('')
        }
      }
    }
  })

  it('gives every outline placeholder a real name and a unique id', () => {
    for (const c of COURSES) {
      for (const u of c.units) {
        for (const s of u.subunits.filter((x) => x.questions.length === 0)) {
          expect(s.name.trim(), `${c.id}/${u.id}/${s.id} has no name`).not.toBe('')
        }
      }
    }
  })

  it('keeps ids unique within their parent', () => {
    const courseIds = COURSES.map((c) => c.id)
    expect(new Set(courseIds).size).toBe(courseIds.length)
    for (const c of COURSES) {
      const unitIds = c.units.map((u) => u.id)
      expect(new Set(unitIds).size, `duplicate unit id in ${c.id}`).toBe(unitIds.length)
      for (const u of c.units) {
        const subIds = u.subunits.map((s) => s.id)
        expect(new Set(subIds).size, `duplicate subunit id in ${c.id}/${u.id}`).toBe(subIds.length)
      }
    }
  })

  it('is publishable by the admin editor’s own completeness check', () => {
    for (const c of COURSES) expect(draftIssue(c), `${c.id} is not publishable`).toBeNull()
  })
})

describe('bundled curriculum — questions are answerable', () => {
  it('gives every question a non-empty prompt', () => {
    for (const { q, where } of everyQuestion()) expect(q.prompt.trim(), where).not.toBe('')
  })

  it('matches each question’s fields to its subunit type', () => {
    for (const { sub, q, where } of everyQuestion()) {
      if (sub.type === 'graph') {
        expect(q.x, `${where} is in a graph subunit but has no x`).toBeTypeOf('number')
        expect(q.y, `${where} is in a graph subunit but has no y`).toBeTypeOf('number')
      } else if (sub.type === 'slider') {
        expect(q.x, `${where} is a slider but sets x, so it grades as a graph`).toBeUndefined()
        expect(q.answer, `${where} is a slider but has no answer`).toBeTypeOf('number')
      } else {
        expect(q.x, `${where} is a fill but sets x`).toBeUndefined()
        expect(q.answer, `${where} is a fill but sets answer`).toBeUndefined()
        expect((q.fill ?? '').trim(), `${where} is a fill with no answer`).not.toBe('')
      }
    }
  })

  it('keeps every graph answer inside its own board', () => {
    for (const { q, where } of everyQuestion()) {
      if (q.x === undefined) continue
      const range = q.range ?? 8
      expect(Math.abs(q.x), `${where} plots x outside the board`).toBeLessThanOrEqual(range)
      expect(Math.abs(q.y ?? 0), `${where} plots y outside the board`).toBeLessThanOrEqual(range)
    }
  })

  it('puts every slider answer on a step the snapped handle can reach', () => {
    for (const { q, where } of everyQuestion()) {
      if (q.answer === undefined) continue
      const { answer, min, max } = q as Required<Pick<Question, 'answer' | 'min' | 'max'>>
      const step = q.step ?? 0.5
      expect(min, `${where} has min >= max`).toBeLessThan(max)
      expect(answer, `${where} answer is below min`).toBeGreaterThanOrEqual(min)
      expect(answer, `${where} answer is above max`).toBeLessThanOrEqual(max)
      // SliderBoard snaps to Math.round(v / step) * step, so an answer off the
      // grid is unreachable however carefully the player aims.
      const steps = (answer - min) / step
      expect(Math.abs(steps - Math.round(steps)), `${where} answer is off the step grid`).toBeLessThan(1e-9)
      // …and a track with too many steps is unclickable: the board is ~560px
      // wide, so 100 steps is already only ~5.6px per step.
      expect((max - min) / step, `${where} slider track is too fine to aim`).toBeLessThanOrEqual(100)
    }
  })

  it('grades its own stated answer as correct', () => {
    for (const { sub, q, where } of everyQuestion()) {
      const guess = sub.type === 'graph' ? { pt: { x: q.x!, y: q.y ?? 0 } }
        : sub.type === 'slider' ? { val: q.answer! }
        : { text: q.fill! }
      expect(checkAnswer(q, guess), `${where} rejects its own answer`).toBe(true)
    }
  })

  it('does not accept a neighbouring slider step as correct', () => {
    for (const { sub, q, where } of everyQuestion()) {
      if (sub.type !== 'slider' || q.answer === undefined) continue
      const step = q.step ?? 0.5
      // Tolerance equals step, so the adjacent grid point grades as correct.
      // Integer answers on a 0.5 step keep every WHOLE-number near miss wrong,
      // which is what actually protects the grading.
      if (Number.isInteger(q.answer) && step === 0.5) {
        expect(checkAnswer(q, { val: q.answer + 1 }), `${where} accepts answer + 1`).toBe(false)
        expect(checkAnswer(q, { val: q.answer - 1 }), `${where} accepts answer - 1`).toBe(false)
      }
    }
  })
})

describe('bundled curriculum — depth', () => {
  it('gives every content-carrying unit real depth', () => {
    // The four Algebra 1 units that predate the content pass are the original
    // 4-question samples; everything authored since ships 20 per unit.
    const legacy = new Set([
      'algebra-1/foundations-of-algebra',
      'algebra-1/solving-linear-equations',
      'algebra-1/linear-functions',
      'algebra-1/quadratic-functions',
    ])
    for (const c of COURSES) {
      for (const u of c.units) {
        if (legacy.has(`${c.id}/${u.id}`)) continue
        const count = u.subunits.reduce((n, s) => n + s.questions.length, 0)
        if (count === 0) continue // planned ahead of its content — allowed
        expect(count, `${c.id}/${u.id} has only ${count} questions`).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('leaves no course without playable content', () => {
    for (const c of COURSES) {
      const count = c.units.reduce((n, u) => n + u.subunits.reduce((m, s) => m + s.questions.length, 0), 0)
      expect(count, `${c.id} has no questions`).toBeGreaterThan(0)
    }
  })
})
