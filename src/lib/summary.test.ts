import { describe, it, expect } from 'vitest'
import { summarize, MIN_FOR_VERDICT, STRUGGLING_PCT, STRONG_PCT, type AnsweredItem } from './summary'

const a = (subunitId: string, correct: boolean, subunitName = subunitId): AnsweredItem =>
  ({ subunitId, subunitName, correct })

describe('summarize', () => {
  it('is empty and safe with no answers', () => {
    const s = summarize([])
    expect(s).toMatchObject({ answered: 0, correct: 0, pct: 0 })
    expect(s.bySubtopic).toEqual([])
    expect(s.struggling).toEqual([])
    expect(s.strong).toEqual([])
  })

  it('counts the whole session', () => {
    const s = summarize([a('x', true), a('x', false), a('y', true), a('y', true)])
    expect(s.answered).toBe(4)
    expect(s.correct).toBe(3)
    expect(s.pct).toBe(75)
  })

  it('tallies each subtopic separately', () => {
    const s = summarize([a('slope', true), a('slope', false), a('area', true)])
    const slope = s.bySubtopic.find((t) => t.subunitId === 'slope')
    expect(slope).toMatchObject({ answered: 2, correct: 1, pct: 50 })
    expect(s.bySubtopic.find((t) => t.subunitId === 'area')).toMatchObject({ answered: 1, correct: 1, pct: 100 })
  })

  it('keeps the display name of the subtopic', () => {
    const s = summarize([a('two-step-equations', true, 'Two-step equations')])
    expect(s.bySubtopic[0].name).toBe('Two-step equations')
  })

  it('orders subtopics weakest first', () => {
    const s = summarize([
      a('good', true), a('good', true),
      a('bad', false), a('bad', false),
      a('mid', true), a('mid', false),
    ])
    expect(s.bySubtopic.map((t) => t.subunitId)).toEqual(['bad', 'mid', 'good'])
  })

  it('breaks an accuracy tie toward the more-answered subtopic', () => {
    const s = summarize([a('few', false), a('many', false), a('many', false), a('many', false)])
    expect(s.bySubtopic.map((t) => t.subunitId)).toEqual(['many', 'few'])
  })

  it('flags a subtopic below the struggling threshold', () => {
    // 1/3 = 33% — under STRUGGLING_PCT, and over the attempt floor
    const s = summarize([a('factoring', true), a('factoring', false), a('factoring', false)])
    expect(s.struggling.map((t) => t.subunitId)).toEqual(['factoring'])
    expect(s.strong).toEqual([])
    expect(STRUGGLING_PCT).toBeLessThan(STRONG_PCT)
  })

  it('flags a subtopic at or above the strong threshold', () => {
    const s = summarize([a('slope', true), a('slope', true)])
    expect(s.strong.map((t) => t.subunitId)).toEqual(['slope'])
    expect(s.struggling).toEqual([])
  })

  it('rates neither way in between', () => {
    // 2/3 = 67% — above struggling, below strong
    const s = summarize([a('mid', true), a('mid', true), a('mid', false)])
    expect(s.struggling).toEqual([])
    expect(s.strong).toEqual([])
    expect(s.bySubtopic).toHaveLength(1)
  })

  it('refuses to judge a subtopic answered too few times', () => {
    // one wrong answer is not evidence of a weakness — it still shows in the
    // breakdown, just without a verdict.
    const s = summarize([a('once', false)])
    expect(s.struggling).toEqual([])
    expect(s.strong).toEqual([])
    expect(s.bySubtopic.map((t) => t.subunitId)).toEqual(['once'])
    expect(MIN_FOR_VERDICT).toBeGreaterThan(1)
  })

  it('never puts a subtopic in both buckets', () => {
    const s = summarize([
      a('a', false), a('a', false),
      a('b', true), a('b', true),
      a('c', true), a('c', false),
    ])
    const overlap = s.struggling.filter((t) => s.strong.some((o) => o.subunitId === t.subunitId))
    expect(overlap).toEqual([])
  })
})
