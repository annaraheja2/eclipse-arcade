import { describe, it, expect } from 'vitest'
import { TABLE_RULES, tableRules } from './gameTables'
import { ROOM_MAX_SEATS, type GameKind, type GameRoom } from './gameroom'
import { toCardPublic } from './cardRoom'
import { toAscendState } from './ascendRoom'

const KINDS: GameKind[] = ['ascend', 'cardgame', 'racer']

const room = (over: Partial<GameRoom> = {}): GameRoom => ({
  id: 'g1',
  game: 'cardgame',
  host: 'host',
  members: ['host'],
  invited: [],
  names: {},
  status: 'lobby',
  sel: { courseId: 'c', unitId: 'u', subunitId: 's', difficulty: 'easy' },
  seed: 4242,
  seatUids: ['host'],
  state: null,
  tick: 0,
  turnStartedAtMs: 0,
  createdAtMs: 0,
  updatedAtMs: 0,
  ...over,
})

describe('TABLE_RULES', () => {
  it.each(KINDS)('%s seats at least two and no more than the rules allow', (kind) => {
    const { maxSeats } = TABLE_RULES[kind]
    expect(maxSeats).toBeGreaterThanOrEqual(2)
    expect(maxSeats).toBeLessThanOrEqual(ROOM_MAX_SEATS)
  })

  it.each(KINDS)('%s opens on a state the room document can carry', (kind) => {
    const state = TABLE_RULES[kind].seatState(2, room({ game: kind }))
    expect(state).toBeTypeOf('object')
    expect(Array.isArray(state)).toBe(false)
  })

  it('deals the Card Game from the room seed, so every client agrees', () => {
    const rules = tableRules('cardgame')
    const a = toCardPublic(rules.seatState(3, room({ seed: 7 })))
    const b = toCardPublic(rules.seatState(3, room({ seed: 7 })))
    const other = toCardPublic(rules.seatState(3, room({ seed: 8 })))
    expect(a).not.toBeNull()
    expect(a).toEqual(b)
    expect(a).not.toEqual(other)
  })

  it('sizes the Card Game state to whoever sat down', () => {
    const rules = tableRules('cardgame')
    expect(toCardPublic(rules.seatState(2, room()))?.counts).toHaveLength(2)
    expect(toCardPublic(rules.seatState(4, room()))?.counts).toHaveLength(4)
  })

  it('sizes an Ascend board to whoever sat down', () => {
    const rules = tableRules('ascend')
    expect(toAscendState(rules.seatState(3, room({ game: 'ascend' })))?.positions).toHaveLength(3)
  })
})
