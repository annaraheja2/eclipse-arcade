import { describe, it, expect } from 'vitest'
import { poolFor, unitQuestionCount, shuffle, startQueue, advance, current, answerText, type PracticeItem } from './practice'
import { g, s, f } from '../data/types'
import type { Course, Question, Subunit, Unit } from '../data/subjects'

const sub = (id: string, questions: Question[], name = id): Subunit =>
  ({ id, name, difficulty: 'easy', type: 'fill', questions })
const unit = (id: string, subunits: Subunit[]): Unit => ({ id, name: id, subunits })

const COURSE: Course = {
  id: 'c', name: 'C',
  units: [
    unit('u1', [
      sub('a', [f('a1', 'x'), f('a2', 'y')], 'Alpha'),
      sub('b', [f('b1', 'z')]),
      sub('empty', []),
    ]),
    unit('u2', [sub('c', [f('c1', 'w')])]),
  ],
}

// A counted rng that walks 0, 0.1, 0.2… — deterministic without being constant.
function seq(): () => number {
  let i = 0
  return () => ((i++ % 10) / 10)
}

describe('poolFor', () => {
  it('collects the selected subtopics in curriculum order', () => {
    const pool = poolFor(COURSE, 'u1', new Set(['b', 'a']))
    expect(pool.map((p) => p.q.prompt)).toEqual(['a1', 'a2', 'b1'])
  })
  it('tags every question with the subtopic it came from', () => {
    const pool = poolFor(COURSE, 'u1', new Set(['a']))
    expect(pool[0]).toMatchObject({ subunitId: 'a', subunitName: 'Alpha' })
    // the tag is what the end-of-session summary groups by
    expect(new Set(pool.map((p) => p.subunitId))).toEqual(new Set(['a']))
  })
  it('ignores subtopics from other units', () => {
    expect(poolFor(COURSE, 'u1', new Set(['c']))).toEqual([])
  })
  it('is empty for an unknown unit', () => {
    expect(poolFor(COURSE, 'nope', new Set(['a']))).toEqual([])
  })
})

describe('unitQuestionCount', () => {
  it('sums every subtopic', () => {
    expect(unitQuestionCount(COURSE.units[0])).toBe(3)
  })
  it('is 0 for an outline-only unit', () => {
    expect(unitQuestionCount(unit('u3', [sub('x', [])]))).toBe(0)
  })
})

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    const items = [1, 2, 3, 4, 5]
    const out = shuffle(items, seq())
    expect(out.slice().sort()).toEqual(items)
  })
  it('does not mutate the input', () => {
    const items = [1, 2, 3]
    shuffle(items, seq())
    expect(items).toEqual([1, 2, 3])
  })
  it('is deterministic for a given rng', () => {
    expect(shuffle([1, 2, 3, 4], seq())).toEqual(shuffle([1, 2, 3, 4], seq()))
  })
})

describe('the practice queue', () => {
  const pool = poolFor(COURSE, 'u1', new Set(['a', 'b']))

  it('opens on a question from the pool', () => {
    const q = startQueue(pool, seq())
    expect(q.index).toBe(0)
    expect(pool).toContain(current(q))
  })

  it('shows every question once before repeating any', () => {
    let q = startQueue(pool, seq())
    const seen: PracticeItem[] = []
    for (let i = 0; i < pool.length; i++) { seen.push(current(q)!); q = advance(q, seq()) }
    expect(new Set(seen).size).toBe(pool.length)
  })

  it('reshuffles into a fresh pass at the end', () => {
    let q = startQueue(pool, seq())
    for (let i = 0; i < pool.length; i++) q = advance(q, seq())
    expect(q.index).toBe(0)
    expect(q.items.length).toBe(pool.length)
  })

  it('never opens a new pass on the question just answered', () => {
    const qs = [f('one', '1'), f('two', '2'), f('three', '3')]
    // Scripted rng: the first draw sends the tail question to the head and the
    // rest are self-swaps — precisely the shuffle the head swap exists for.
    const script = [0, 0.99]
    let k = 0
    const rng = () => script[k++] ?? 0.99
    const wrapped = advance({ items: qs, index: 2 }, rng)
    expect(wrapped.index).toBe(0)
    expect(current(wrapped)).not.toBe(qs[2])
    expect(new Set(wrapped.items).size).toBe(3)
  })

  it('survives a single-question pool', () => {
    const one = startQueue([f('only', 'q')], seq())
    expect(current(advance(one, seq()))?.prompt).toBe('only')
  })

  it('has no current question when nothing was selected', () => {
    expect(current(startQueue([], seq()))).toBeUndefined()
  })
})

describe('leaving a generated detour', () => {
  // Practice can spin a fresh question off a template ("one more like this").
  // That detour happens AFTER its authored question was answered, so moving on
  // has to advance the queue — staying put re-asked the answered question with
  // its answer still on screen, and counted it a second time.
  it('advances past the question the detour came from', () => {
    const pool = poolFor(COURSE, 'u1', new Set(['a', 'b']))
    const opened = startQueue(pool, seq())
    const first = current(opened)
    const after = advance(opened, seq())
    expect(current(after)).not.toBe(first)
  })
})

describe('answerText', () => {
  it('reads a graph answer as a point', () => {
    expect(answerText(g('plot it', 3, -2))).toBe('(3, -2)')
  })
  it('reads a slider answer as its value', () => {
    expect(answerText(s('how many', 12, 0, 20))).toBe('12')
  })
  it('reads a fill answer as its word', () => {
    expect(answerText(f('name it', 'hypotenuse'))).toBe('hypotenuse')
  })
  it('dispatches on the same fields checkAnswer grades on', () => {
    // x wins over answer, exactly as in checkAnswer — otherwise practice would
    // reveal an answer the grader doesn't accept.
    expect(answerText({ prompt: 'both', x: 1, y: 2, answer: 9 })).toBe('(1, 2)')
  })
})
