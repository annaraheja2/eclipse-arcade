import { describe, it, expect } from 'vitest'
import {
  createAscendState, applyAscendAnswer, isOver, ascendPlacements, ascendScoreFor,
  toAscendState, ascendStateData, MAX_SEATS, type AscendState,
} from './ascendRoom'
import { LAST_SQUARE, START_SQUARE, LADDERS, SNAKES, POINTS_PER_CORRECT } from './ascend'

const fresh = (seats = 3) => createAscendState(seats)

describe('a new race', () => {
  it('puts everyone on the start pad with nothing scored', () => {
    const s = fresh(3)
    expect(s.positions).toEqual([START_SQUARE, START_SQUARE, START_SQUARE])
    expect(s.correct).toEqual([0, 0, 0])
    expect(s.turn).toBe(0)
    expect(s.winner).toBe(-1)
    expect(s.last).toBeNull()
    expect(isOver(s)).toBe(false)
  })
  it('clamps the table to a sane size', () => {
    expect(createAscendState(0).positions).toHaveLength(1)
    expect(createAscendState(99).positions).toHaveLength(MAX_SEATS)
  })
})

describe('taking a turn', () => {
  it('climbs on a correct answer and counts it', () => {
    // 5 is a plain square — 1, 4 and 9 all have ladders on them.
    const s = applyAscendAnswer(fresh(), true, 5)
    expect(s.positions[0]).toBe(5)
    expect(s.correct[0]).toBe(1)
    expect(s.turn).toBe(1)
  })

  it('forfeits the throw on a wrong answer but still passes the turn', () => {
    const s = applyAscendAnswer(fresh(), false, 6)
    expect(s.positions[0]).toBe(START_SQUARE)
    expect(s.correct[0]).toBe(0)
    expect(s.turn).toBe(1)
    expect(s.last).toMatchObject({ seat: 0, correct: false, roll: 0 })
  })

  it('wraps the turn back to the first seat', () => {
    let s = fresh(3)
    for (let i = 0; i < 3; i++) s = applyAscendAnswer(s, false, 0)
    expect(s.turn).toBe(0)
  })

  it('never mutates the state handed in', () => {
    const before = fresh()
    const snapshot = JSON.stringify(before)
    applyAscendAnswer(before, true, 5)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('rides a ladder up', () => {
    const base = Number(Object.keys(LADDERS)[0])
    const s = applyAscendAnswer(fresh(), true, base)
    expect(s.positions[0]).toBe(LADDERS[base])
    expect(s.last?.chute).toMatchObject({ kind: 'ladder' })
  })

  it('slides down a snake', () => {
    const head = Number(Object.keys(SNAKES)[0])
    // Walk up to just below the head so the throw stays inside a die's range.
    const s = fresh()
    s.positions[0] = head - 2
    const after = applyAscendAnswer(s, true, 2)
    expect(after.positions[0]).toBe(SNAKES[head])
    expect(after.last?.chute).toMatchObject({ kind: 'snake', from: head })
  })
})

describe('finishing', () => {
  const atTop = (): AscendState => {
    const s = fresh(3)
    s.positions[0] = LAST_SQUARE - 3
    return s
  }

  it('wins by landing exactly on the last square', () => {
    const s = applyAscendAnswer(atTop(), true, 3)
    expect(s.winner).toBe(0)
    expect(isOver(s)).toBe(true)
  })

  it('bounces back on an overshoot rather than winning', () => {
    const s = applyAscendAnswer(atTop(), true, 5)
    expect(s.winner).toBe(-1)
    expect(s.positions[0]).toBeLessThan(LAST_SQUARE)
  })

  it('stops accepting turns once someone is home', () => {
    const won = applyAscendAnswer(atTop(), true, 3)
    expect(applyAscendAnswer(won, true, 6)).toBe(won)
  })

  it('leaves the pointer on the winner rather than advancing past them', () => {
    const won = applyAscendAnswer(atTop(), true, 3)
    expect(won.turn).toBe(0)
  })
})

describe('placements and score', () => {
  it('ranks the winner first and the rest by height', () => {
    const s = fresh(3)
    s.positions = [LAST_SQUARE - 2, 40, 70]
    const won = applyAscendAnswer(s, true, 2)
    // seat 0 home; seat 2 (70) ahead of seat 1 (40)
    expect(ascendPlacements(won)).toEqual([1, 3, 2])
  })

  it('reports no placings while the race is still on', () => {
    expect(ascendPlacements(fresh(3))).toEqual([0, 0, 0])
  })

  it('scores correct answers plus the placement bonus', () => {
    const s = fresh(2)
    s.positions = [LAST_SQUARE - 1, 10]
    s.correct = [7, 2]
    const won = applyAscendAnswer(s, true, 1)
    // the winning answer counts too: 8 correct, 1st place
    expect(ascendScoreFor(won, 0)).toBe(8 * POINTS_PER_CORRECT + 1000)
    expect(ascendScoreFor(won, 1)).toBe(2 * POINTS_PER_CORRECT + 400)
  })
})

describe('reading an untrusted room document', () => {
  it('round-trips a real state', () => {
    const s = applyAscendAnswer(fresh(3), true, 4)
    expect(toAscendState(ascendStateData(s))).toEqual(s)
  })

  it('round-trips the opening state, where there is no last move', () => {
    const s = fresh(2)
    expect(toAscendState(ascendStateData(s))).toEqual(s)
  })

  it('rejects rubbish', () => {
    expect(toAscendState(null)).toBeNull()
    expect(toAscendState('nope')).toBeNull()
    expect(toAscendState({})).toBeNull()
  })

  it('rejects a table that is the wrong size', () => {
    expect(toAscendState({ positions: [], correct: [], turn: 0, winner: -1 })).toBeNull()
    const tooMany = new Array(MAX_SEATS + 1).fill(0)
    expect(toAscendState({ positions: tooMany, correct: tooMany, turn: 0, winner: -1 })).toBeNull()
  })

  it('rejects a position off the board', () => {
    expect(toAscendState({ positions: [LAST_SQUARE + 1], correct: [0], turn: 0, winner: -1 })).toBeNull()
    expect(toAscendState({ positions: [-1], correct: [0], turn: 0, winner: -1 })).toBeNull()
  })

  it('rejects a turn or winner pointing at a seat that does not exist', () => {
    expect(toAscendState({ positions: [0, 0], correct: [0, 0], turn: 5, winner: -1 })).toBeNull()
    expect(toAscendState({ positions: [0, 0], correct: [0, 0], turn: 0, winner: 9 })).toBeNull()
  })

  it('rejects mismatched arrays rather than reading past the end', () => {
    expect(toAscendState({ positions: [0, 0], correct: [0], turn: 0, winner: -1 })).toBeNull()
  })

  it('drops a malformed last move but keeps the state', () => {
    const s = toAscendState({ positions: [0], correct: [0], turn: 0, winner: -1, last: { seat: 99 } })
    expect(s).not.toBeNull()
    expect(s?.last).toBeNull()
  })

  it('writes no undefined, which Firestore refuses', () => {
    const data = ascendStateData(fresh(2))
    expect(JSON.stringify(data)).not.toContain('undefined')
    expect(data.last).toBeNull()
  })
})
