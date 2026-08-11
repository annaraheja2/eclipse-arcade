import { describe, it, expect } from 'vitest'
import {
  LIVES, TURN_TIME_MAX, TURN_TIME_MIN,
  createLobby, isAlive, aliveSeats, lobbySeats,
  timeForTurn, applyAnswer, banish,
  aiRateFor, aiAnswerChance, aiSolves, aiBanishTarget,
  scoreForPlacement, type LsState,
} from './laststanding'

const AI_NAMES = ['NOVA', 'VEGA', 'ORION', 'LYRA'] as const

const fresh = () => createLobby(AI_NAMES)

/** Drive `seat` to elimination: answer wrong on their turns, others correct. */
function eliminate(state: LsState, seat: number): LsState {
  let s = state
  while (s.phase.kind === 'turn' && s.seats[seat].lives > 0) {
    s = applyAnswer(s, s.turn !== seat)
  }
  return s
}

describe('createLobby', () => {
  it('seats the human at 0 with AI rivals, all in with full lives', () => {
    const s = fresh()
    expect(s.seats).toHaveLength(5)
    expect(s.seats[0].kind).toBe('human')
    expect(s.seats.slice(1).every((p) => p.kind === 'ai')).toBe(true)
    expect(s.seats.every((p) => p.inLobby && p.lives === LIVES && p.turnsTaken === 0)).toBe(true)
    expect(s.round).toBe(1)
    expect(s.turn).toBe(0)
    expect(s.phase).toEqual({ kind: 'turn' })
  })
})

describe('timeForTurn', () => {
  it('starts at 30 and drops 1s per turn taken', () => {
    expect(timeForTurn(0)).toBe(TURN_TIME_MAX)
    expect(timeForTurn(1)).toBe(29)
    expect(timeForTurn(7)).toBe(23)
  })
  it('clamps to the floor', () => {
    expect(timeForTurn(25)).toBe(TURN_TIME_MIN)
    expect(timeForTurn(100)).toBe(TURN_TIME_MIN)
  })
})

describe('applyAnswer', () => {
  it('correct keeps lives; either way the turn counts and play advances', () => {
    const s = applyAnswer(fresh(), true)
    expect(s.seats[0].lives).toBe(LIVES)
    expect(s.seats[0].turnsTaken).toBe(1)
    expect(s.turn).toBe(1)
  })

  it('wrong (or timeout) costs a life', () => {
    const s = applyAnswer(fresh(), false)
    expect(s.seats[0].lives).toBe(LIVES - 1)
    expect(s.turn).toBe(1)
  })

  it('losing both lives eliminates for the round and turns skip the eliminated seat', () => {
    const s = eliminate(fresh(), 1)
    expect(s.seats[1].lives).toBe(0)
    expect(isAlive(s.seats[1])).toBe(false)
    expect(s.seats[1].inLobby).toBe(true) // eliminated, not banished
    // a full loop of correct answers never lands on seat 1 again
    let cur = s
    for (let i = 0; i < 8; i++) {
      expect(cur.turn).not.toBe(1)
      cur = applyAnswer(cur, true)
    }
  })

  it('detects the last player standing and enters the banish phase', () => {
    let s = fresh()
    for (const seat of [1, 2, 3, 4]) s = eliminate(s, seat)
    expect(s.phase).toEqual({ kind: 'banish', winner: 0 })
    expect(aliveSeats(s).map((p) => p.seat)).toEqual([0])
  })

  it('is a no-op outside the turn phase', () => {
    let s = fresh()
    for (const seat of [1, 2, 3, 4]) s = eliminate(s, seat)
    expect(applyAnswer(s, false)).toBe(s)
  })
})

describe('banish', () => {
  function wonByHuman(): LsState {
    let s = fresh()
    for (const seat of [1, 2, 3, 4]) s = eliminate(s, seat)
    return s
  }

  it('permanently removes the target and starts the next round with lives reset', () => {
    const next = banish(wonByHuman(), 3)
    expect(next.seats[3].inLobby).toBe(false)
    expect(lobbySeats(next).map((p) => p.seat)).toEqual([0, 1, 2, 4])
    expect(next.round).toBe(2)
    expect(next.phase).toEqual({ kind: 'turn' })
    expect(next.turn).toBe(0) // the round winner leads the next round
    for (const p of lobbySeats(next)) {
      expect(p.lives).toBe(LIVES)
      expect(p.turnsTaken).toBe(0) // the timer ramp resets each round
    }
  })

  it('rejects banishing yourself or a seat already out', () => {
    const s = wonByHuman()
    expect(banish(s, 0)).toBe(s)
    const afterOne = banish(s, 3)
    // afterOne is mid-round-2; banish is illegal there too
    expect(banish(afterOne, 1)).toBe(afterOne)
  })

  it('crowns the champion when one player remains', () => {
    let s = wonByHuman()
    for (const target of [1, 2, 3]) {
      s = banish(s, target)
      // re-win the shrunken round
      for (const p of aliveSeats(s)) { if (p.seat !== 0) s = eliminate(s, p.seat) }
    }
    expect(s.phase).toEqual({ kind: 'banish', winner: 0 })
    const done = banish(s, 4)
    expect(done.phase).toEqual({ kind: 'champion', champion: 0 })
    expect(lobbySeats(done).map((p) => p.seat)).toEqual([0])
  })
})

describe('AI model', () => {
  it('rates descend by index and clamp to the table', () => {
    expect(aiRateFor(0)).toBeGreaterThan(aiRateFor(1))
    expect(aiRateFor(3)).toBe(aiRateFor(99)) // out-of-range clamps to the last
    expect(aiRateFor(0, 'hard')).toBeGreaterThan(aiRateFor(0, 'easy'))
  })

  it('answer chance is full at 30s and degrades toward the floor', () => {
    expect(aiAnswerChance(0.8, TURN_TIME_MAX)).toBeCloseTo(0.8)
    expect(aiAnswerChance(0.8, 15)).toBeLessThan(0.8)
    expect(aiAnswerChance(0.8, TURN_TIME_MIN)).toBeLessThan(aiAnswerChance(0.8, 15))
    expect(aiAnswerChance(0.8, TURN_TIME_MIN)).toBeGreaterThan(0)
  })

  it('aiSolves is a single draw against the chance', () => {
    expect(aiSolves(() => 0.2, 0.5)).toBe(true)
    expect(aiSolves(() => 0.9, 0.5)).toBe(false)
  })

  it('banish target is whoever lasted longest, ties to the lowest seat', () => {
    let s = fresh()
    // eliminate 1 first (fewest turns survived), then 2, then 3 — seat 4 wins...
    // actually let seat 0 win: knock out 1, 2, 3, 4 in order; 4 lasted longest.
    for (const seat of [1, 2, 3, 4]) s = eliminate(s, seat)
    expect(s.phase.kind).toBe('banish')
    expect(aiBanishTarget(s, 0)).toBe(4)
  })

  it('banish target tie-break is deterministic (lowest seat)', () => {
    const s = fresh()
    // untouched lobby: everyone equal — the lowest non-winner seat wins the tie
    const tied: LsState = { ...s, phase: { kind: 'banish', winner: 2 } }
    expect(aiBanishTarget(tied, 2)).toBe(0)
  })
})

describe('scoreForPlacement', () => {
  it('pays the champion most and steps down by players outlasted', () => {
    expect(scoreForPlacement(1, 5)).toBe(5000)
    expect(scoreForPlacement(2, 5)).toBe(2250)
    expect(scoreForPlacement(3, 5)).toBe(1500)
    expect(scoreForPlacement(4, 5)).toBe(750)
    expect(scoreForPlacement(5, 5)).toBe(0)
  })
})
