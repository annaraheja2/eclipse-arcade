// The guardrail for bundled templates — the counterpart to courses.test.ts,
// which does the same job for hand-authored questions. A template that ships
// broken would put an ungradeable question in front of a student, so every one
// here is checked statically AND drawn from many times.
import { describe, it, expect } from 'vitest'
import { TEMPLATES, templatesFor, hasTemplate } from './templates'
import { templateIssue, instantiate } from '../lib/templates'
import { checkAnswer } from '../components/QuestionPanel'
import { COURSES } from './subjects'

// Every subtopic id the curriculum actually defines.
const SUBUNIT_IDS = new Set(
  COURSES.flatMap((c) => c.units.flatMap((u) => u.subunits.map((s) => s.id))),
)

function rngFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('bundled templates', () => {
  it('ships at least one', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0)
  })

  it('has no duplicate ids', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is structurally sound', (_id, t) => {
    expect(templateIssue(t)).toBeNull()
  })

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is attached to a real subtopic', (_id, t) => {
    // A renamed curriculum topic must not silently orphan its template.
    expect(SUBUNIT_IDS.has(t.subunitId)).toBe(true)
  })

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s draws cleanly 200 times', (_id, t) => {
    for (let seed = 0; seed < 200; seed++) {
      const r = instantiate(t, rngFrom(seed))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const q = r.question

      // No hole left unfilled anywhere a student can read.
      expect(q.prompt).not.toMatch(/\{\w+\}/)
      if (q.explain) expect(q.explain).not.toMatch(/\{\w+\}/)
      expect(q.prompt.trim()).not.toBe('')

      // Never a fill question — the grader can't mark those fairly.
      expect(q.fill).toBeUndefined()

      // The same rules courses.test.ts imposes on hand-authored content.
      if (t.kind === 'slider') {
        expect(q.answer).toBeDefined()
        expect(q.min!).toBeLessThan(q.max!)
        expect(q.answer!).toBeGreaterThanOrEqual(q.min!)
        expect(q.answer!).toBeLessThanOrEqual(q.max!)
        expect(Number.isInteger(q.answer! / q.step!)).toBe(true)
        expect((q.max! - q.min!) / q.step!).toBeLessThanOrEqual(100)
      } else {
        expect(q.x).toBeDefined()
        expect(Math.abs(q.x!)).toBeLessThanOrEqual(q.range!)
        expect(Math.abs(q.y!)).toBeLessThanOrEqual(q.range!)
      }

      // And the real grader accepts the answer it computed.
      const right = t.kind === 'slider'
        ? checkAnswer(q, { val: q.answer })
        : checkAnswer(q, { pt: { x: q.x!, y: q.y! } })
      expect(right).toBe(true)
    }
  })

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s actually varies', (_id, t) => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 30; seed++) {
      const r = instantiate(t, rngFrom(seed))
      if (r.ok) seen.add(r.question.prompt)
    }
    // A template that always produces the same question is a fixed question
    // with extra steps.
    expect(seen.size).toBeGreaterThan(5)
  })
})

describe('lookup', () => {
  it('finds the templates written for a subtopic', () => {
    const t = TEMPLATES[0]
    expect(templatesFor(t.subunitId).map((x) => x.id)).toContain(t.id)
    expect(hasTemplate(t.subunitId)).toBe(true)
  })
  it('reports nothing for a subtopic without one', () => {
    expect(templatesFor('no-such-subtopic')).toEqual([])
    expect(hasTemplate('no-such-subtopic')).toBe(false)
  })
})
