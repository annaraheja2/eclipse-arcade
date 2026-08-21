import { describe, it, expect } from 'vitest'
import {
  toSurvey, surveyData, hasAnswers, tally, summarise,
  ROLES, LEVELS, GOALS, SOURCES, EMPTY_SURVEY, type SurveyRow, type Survey,
} from './survey'

const row = (over: Partial<SurveyRow> = {}): SurveyRow => ({
  uid: 'u', role: null, level: null, goal: null, source: null,
  skipped: false, createdAtMs: 0, ...over,
})

describe('reading a survey document', () => {
  it('reads a full response', () => {
    const s = toSurvey('u1', { role: 'student', level: 'middle', goal: 'catch-up', source: 'teacher', skipped: false })
    expect(s).toMatchObject({ uid: 'u1', role: 'student', level: 'middle', goal: 'catch-up', source: 'teacher' })
  })

  it('reads a skip', () => {
    const s = toSurvey('u1', { skipped: true })
    expect(s?.skipped).toBe(true)
    expect(hasAnswers(s!)).toBe(false)
  })

  it('blanks an option it does not recognise, rather than dropping the response', () => {
    // A renamed or retired option must not make a whole row vanish from the counts.
    const s = toSurvey('u1', { role: 'student', level: 'kindergarten' })
    expect(s?.role).toBe('student')
    expect(s?.level).toBeNull()
  })

  it('rejects rubbish', () => {
    expect(toSurvey('u', null)).toBeNull()
    expect(toSurvey('u', 'nope')).toBeNull()
    expect(toSurvey('u', [])).toBeNull()
  })

  it('treats a missing document body as all blanks', () => {
    const s = toSurvey('u', {})
    expect(s).not.toBeNull()
    expect(hasAnswers(s!)).toBe(false)
    expect(s!.skipped).toBe(false)
  })

  it('writes null rather than undefined, which Firestore refuses', () => {
    const data = surveyData(EMPTY_SURVEY)
    expect(JSON.stringify(data)).not.toContain('undefined')
    expect(data.role).toBeNull()
  })

  it('round-trips a real answer', () => {
    const s: Survey = { role: 'teacher', level: 'high', goal: 'test-prep', source: 'friend', skipped: false, createdAtMs: 0 }
    expect(toSurvey('u', surveyData(s))).toMatchObject({ role: 'teacher', level: 'high', goal: 'test-prep', source: 'friend' })
  })
})

describe('hasAnswers', () => {
  it('is false for a blank sheet', () => {
    expect(hasAnswers(EMPTY_SURVEY)).toBe(false)
  })
  it('is true as soon as one question is answered', () => {
    expect(hasAnswers({ ...EMPTY_SURVEY, goal: 'fun' })).toBe(true)
  })
  it('is true for someone who answered then pressed skip', () => {
    expect(hasAnswers({ ...EMPTY_SURVEY, role: 'student', skipped: true })).toBe(true)
  })
})

describe('counting answers', () => {
  it('counts each option and orders them biggest first', () => {
    const { counts } = tally([
      row({ level: 'middle' }), row({ level: 'middle' }), row({ level: 'high' }),
    ], 'level', LEVELS)
    expect(counts.map((c) => [c.value, c.count])).toEqual([['middle', 2], ['high', 1]])
  })

  it('leaves out options nobody picked', () => {
    const { counts } = tally([row({ role: 'student' })], 'role', ROLES)
    expect(counts).toHaveLength(1)
  })

  it('is a percentage of who answered THIS question, not of everyone', () => {
    // Two answered, two left it blank: the answer that got both is 100%, not 50%.
    const { counts, answered } = tally([
      row({ goal: 'fun' }), row({ goal: 'fun' }), row(), row(),
    ], 'goal', GOALS)
    expect(answered).toBe(2)
    expect(counts[0]).toMatchObject({ value: 'fun', count: 2, pct: 100 })
  })

  it('reports the denominator so it is never guessed at', () => {
    const { answered } = tally([row({ source: 'friend' }), row()], 'source', SOURCES)
    expect(answered).toBe(1)
  })

  it('ignores an answer that is not one of the options', () => {
    const { counts, answered } = tally(
      [{ ...row(), level: 'kindergarten' as never }], 'level', LEVELS,
    )
    expect(counts).toEqual([])
    expect(answered).toBe(0)
  })

  it('is empty-safe', () => {
    const { counts, answered } = tally([], 'role', ROLES)
    expect(counts).toEqual([])
    expect(answered).toBe(0)
  })
})

describe('the admin summary', () => {
  it('counts responses and skips separately', () => {
    const s = summarise([
      row({ role: 'student', level: 'middle' }),
      row({ role: 'teacher' }),
      row({ skipped: true }),
    ])
    expect(s.responses).toBe(3)
    expect(s.skipped).toBe(1)
  })

  it('does not count someone who answered and then skipped as a skip', () => {
    const s = summarise([row({ role: 'student', skipped: true })])
    expect(s.skipped).toBe(0)
    expect(s.role.answered).toBe(1)
  })

  it('breaks down every question', () => {
    const s = summarise([row({ role: 'student', level: 'high', goal: 'fun', source: 'search' })])
    expect(s.role.counts[0].value).toBe('student')
    expect(s.level.counts[0].value).toBe('high')
    expect(s.goal.counts[0].value).toBe('fun')
    expect(s.source.counts[0].value).toBe('search')
  })

  it('is empty-safe, so an admin with no responses sees zeroes not a crash', () => {
    const s = summarise([])
    expect(s).toMatchObject({ responses: 0, skipped: 0 })
    expect(s.role.counts).toEqual([])
  })
})

describe('the options themselves', () => {
  it('has no duplicate values within a question', () => {
    for (const list of [ROLES, LEVELS, GOALS, SOURCES]) {
      const values = list.map((c) => c.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })
  it('labels every option, so the admin screen never shows a raw key', () => {
    for (const list of [ROLES, LEVELS, GOALS, SOURCES]) {
      for (const c of list) expect(c.label.trim().length).toBeGreaterThan(0)
    }
  })
})
