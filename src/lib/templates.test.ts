import { describe, it, expect } from 'vitest'
import { instantiate, instantiateMany, templateIssue, fillPrompt, type QuestionTemplate } from './templates'
import { checkAnswer } from '../components/QuestionPanel'

// A deterministic rng that walks a fixed cycle — reproducible without being constant.
function seq(start = 0): () => number {
  let i = start
  return () => ((i++ % 17) / 17)
}

const SEQUENCE: QuestionTemplate = {
  id: 'arith-seq',
  subunitId: 'arithmetic-sequences',
  kind: 'slider',
  prompt: 'A sequence starts at {a} and goes up by {b} each term. What is term {n}?',
  vars: [
    { name: 'a', min: 2, max: 15 },
    { name: 'b', min: 2, max: 9 },
    { name: 'n', min: 4, max: 10 },
  ],
  answer: 'a + (n - 1) * b',
  min: '0',
  max: 'a + (n - 1) * b + 10',
  step: 1,
  explain: 'Add {b} a total of {n} minus 1 times to {a}.',
}

const VERTEX: QuestionTemplate = {
  id: 'vertex',
  subunitId: 'quadratics',
  kind: 'graph',
  prompt: 'Plot the vertex of y = (x - {h})^2 + {k}',
  vars: [
    { name: 'h', min: -5, max: 5 },
    { name: 'k', min: -5, max: 5 },
  ],
  x: 'h',
  y: 'k',
  range: 8,
}

describe('fillPrompt', () => {
  it('fills every hole', () => {
    expect(fillPrompt('start {a}, step {b}', { a: 3, b: 7 })).toBe('start 3, step 7')
  })
  it('leaves an unknown hole visible rather than blanking it', () => {
    expect(fillPrompt('{a} and {zzz}', { a: 1 })).toBe('1 and {zzz}')
  })
  it('does not reach through the prototype for a hole named like a builtin', () => {
    expect(fillPrompt('{constructor}', { a: 1 })).toBe('{constructor}')
  })
})

describe('templateIssue', () => {
  it('passes a sound template', () => {
    expect(templateIssue(SEQUENCE)).toBeNull()
    expect(templateIssue(VERTEX)).toBeNull()
  })
  it('catches an expression using a variable that does not exist', () => {
    expect(templateIssue({ ...SEQUENCE, answer: 'a + zzz' })).toMatch(/"zzz"/)
  })
  it('catches a missing answer', () => {
    expect(templateIssue({ ...SEQUENCE, answer: undefined })).toMatch(/answer is missing/i)
  })
  it('catches a missing graph coordinate', () => {
    expect(templateIssue({ ...VERTEX, y: undefined })).toMatch(/y value is missing/i)
  })
  it('catches a backwards range', () => {
    expect(templateIssue({ ...SEQUENCE, vars: [{ name: 'a', min: 10, max: 2 }] })).toMatch(/max greater than min/)
  })
  it('catches a duplicate or unusable variable name', () => {
    expect(templateIssue({ ...VERTEX, vars: [{ name: 'h', min: 1, max: 2 }, { name: 'h', min: 1, max: 2 }] }))
      .toMatch(/defined twice/)
    expect(templateIssue({ ...VERTEX, vars: [{ name: '2x', min: 1, max: 2 }] })).toMatch(/not a usable/)
  })
  it('catches a non-positive step', () => {
    expect(templateIssue({ ...SEQUENCE, step: 0 })).toMatch(/step must be positive/)
  })
})

describe('instantiate — slider', () => {
  it('produces a question whose answer is computed correctly', () => {
    const r = instantiate(SEQUENCE, seq())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { a, b, n } = r.vars
    expect(r.question.answer).toBe(a + (n - 1) * b)
  })

  it('fills the prompt and the explanation with the drawn numbers', () => {
    const r = instantiate(SEQUENCE, seq())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.question.prompt).not.toContain('{')
    expect(r.question.explain).not.toContain('{')
    expect(r.question.prompt).toContain(String(r.vars.a))
  })

  it('always lands the answer on the track', () => {
    for (let i = 0; i < 40; i++) {
      const r = instantiate(SEQUENCE, seq(i))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const q = r.question
      expect(q.answer!).toBeGreaterThanOrEqual(q.min!)
      expect(q.answer!).toBeLessThanOrEqual(q.max!)
    }
  })

  it('keeps the track aimable — no more than 100 steps wide', () => {
    for (let i = 0; i < 40; i++) {
      const r = instantiate(SEQUENCE, seq(i))
      if (!r.ok) continue
      const q = r.question
      expect((q.max! - q.min!) / q.step!).toBeLessThanOrEqual(100)
    }
  })

  it('produces answers the real grader accepts', () => {
    for (let i = 0; i < 40; i++) {
      const r = instantiate(SEQUENCE, seq(i))
      if (!r.ok) continue
      // the grader the games actually run
      expect(checkAnswer(r.question, { val: r.question.answer })).toBe(true)
      expect(checkAnswer(r.question, { val: r.question.answer! + 5 })).toBe(false)
    }
  })
})

describe('instantiate — graph', () => {
  it('computes the point and keeps it on the grid', () => {
    for (let i = 0; i < 40; i++) {
      const r = instantiate(VERTEX, seq(i))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const q = r.question
      expect(q.x).toBe(r.vars.h)
      expect(q.y).toBe(r.vars.k)
      expect(Math.abs(q.x!)).toBeLessThanOrEqual(q.range!)
      expect(Math.abs(q.y!)).toBeLessThanOrEqual(q.range!)
    }
  })

  it('produces points the real grader accepts', () => {
    const r = instantiate(VERTEX, seq())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(checkAnswer(r.question, { pt: { x: r.question.x!, y: r.question.y! } })).toBe(true)
    expect(checkAnswer(r.question, { pt: { x: r.question.x! + 3, y: r.question.y! } })).toBe(false)
  })

  it('never generates a fill question, which the grader cannot mark fairly', () => {
    const r = instantiate(SEQUENCE, seq())
    if (!r.ok) return
    expect(r.question.fill).toBeUndefined()
  })
})

describe('guards', () => {
  const DIVIDES: QuestionTemplate = {
    id: 'div', subunitId: 's', kind: 'slider',
    prompt: 'What is {a} divided by {b}?',
    vars: [{ name: 'a', min: 2, max: 60 }, { name: 'b', min: 2, max: 9 }],
    where: ['a % b == 0'],
    answer: 'a / b', min: '0', max: '40', step: 1,
  }

  it('only draws numbers that satisfy them', () => {
    for (let i = 0; i < 30; i++) {
      const r = instantiate(DIVIDES, seq(i))
      if (!r.ok) continue
      expect(r.vars.a % r.vars.b).toBe(0)
      expect(Number.isInteger(r.question.answer!)).toBe(true)
    }
  })

  it('gives up with a readable reason when nothing can satisfy them', () => {
    const impossible: QuestionTemplate = { ...DIVIDES, where: ['a > 1000'] }
    const r = instantiate(impossible, seq())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/ranges and guards/)
  })
})

describe('derived values', () => {
  const EQUATION: QuestionTemplate = {
    id: 'eq', subunitId: 's', kind: 'slider',
    prompt: 'Solve: {a}x + {b} = {c}',
    vars: [{ name: 'a', min: 2, max: 9 }, { name: 'x', min: 1, max: 9 }, { name: 'b', min: 1, max: 9 }],
    lets: [{ name: 'c', expr: 'a * x + b' }],
    answer: 'x', min: '0', max: '12', step: 1,
  }

  it('computes them and makes them available to the prompt', () => {
    const r = instantiate(EQUATION, seq())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.vars.c).toBe(r.vars.a * r.vars.x + r.vars.b)
    expect(r.question.prompt).toContain(String(r.vars.c))
    expect(r.question.prompt).not.toContain('{')
  })

  it('lets a later value build on an earlier one', () => {
    const r = instantiate({
      ...EQUATION,
      lets: [{ name: 'c', expr: 'a * x + b' }, { name: 'twice_c', expr: 'c * 2' }],
      prompt: '{c} then {twice_c}',
    }, seq())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.vars.twice_c).toBe(r.vars.c * 2)
  })

  it('rejects one that reads a name defined after it', () => {
    const issue = templateIssue({
      ...EQUATION,
      lets: [{ name: 'c', expr: 'later + 1' }, { name: 'later', expr: '2' }],
    })
    expect(issue).toMatch(/"later"/)
  })

  it('rejects one that collides with a variable', () => {
    expect(templateIssue({ ...EQUATION, lets: [{ name: 'a', expr: '1' }] })).toMatch(/defined twice/)
  })
})

describe('variety', () => {
  it('gives different questions across draws', () => {
    const prompts = new Set(instantiateMany(SEQUENCE, 12, seq()).map((q) => q.prompt))
    expect(prompts.size).toBeGreaterThan(1)
  })
  it('is reproducible for a given sequence of numbers', () => {
    const a = instantiateMany(SEQUENCE, 5, seq())
    const b = instantiateMany(SEQUENCE, 5, seq())
    expect(a).toEqual(b)
  })
  it('returns nothing rather than junk from a broken template', () => {
    expect(instantiateMany({ ...SEQUENCE, answer: 'nope' }, 5, seq())).toEqual([])
  })
})
