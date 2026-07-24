import { describe, it, expect } from 'vitest'
import {
  makeDeck, shuffle, createGame, legalPlays, requiredDifficulty,
  playCard, stackOrTake, drawToPlay, aiChoose, aiSolves, aiCorrectRate,
  topCard, winnerOf, handCounts, nextPlayer,
  COLORS, HAND_SIZE, DECK_SIZE, PLAYER_MIN, PLAYER_MAX,
  type Card, type GameState, type Color, type NumberCard,
} from './cardgame'

// A tiny deterministic rng: yields each value in `seq`, then repeats the last.
function seqRng(...seq: number[]): () => number {
  let i = 0
  return () => seq[Math.min(i++, seq.length - 1)]
}
// A seeded generator for a reproducible full shuffle.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// rng that must never be called (used where no draw/reshuffle can occur).
const noRng = (): number => { throw new Error('rng called unexpectedly') }

// ---- card factories (stable, unique ids) ---------------------------------
let idSeq = 0
const uid = () => `t${idSeq++}`
const num = (color: Color, value: number): NumberCard => ({ kind: 'number', color, value, id: uid() })
const skip = (color: Color): Card => ({ kind: 'skip', color, id: uid() })
const rev = (color: Color): Card => ({ kind: 'reverse', color, id: uid() })
const d2 = (color: Color): Card => ({ kind: 'draw2', color, id: uid() })
const wild = (): Card => ({ kind: 'wild', color: null, id: uid() })
const w4 = (): Card => ({ kind: 'wild4', color: null, id: uid() })

function mk(over: Partial<GameState> & { players: Card[][]; discard: Card[] }): GameState {
  const top = over.discard[over.discard.length - 1]
  return {
    players: over.players,
    drawPile: over.drawPile ?? [],
    discard: over.discard,
    currentColor: over.currentColor ?? (top.color ?? 'red'),
    turn: over.turn ?? 0,
    direction: over.direction ?? 1,
    pendingDraw: over.pendingDraw ?? 0,
    pendingKind: over.pendingKind ?? null,
    winner: over.winner ?? null,
  }
}

describe('makeDeck', () => {
  const deck = makeDeck()
  it('is a full 108-card deck', () => {
    expect(deck).toHaveLength(DECK_SIZE)
    expect(new Set(deck.map((c) => c.id)).size).toBe(DECK_SIZE) // every id unique
  })
  it('has the standard per-color number spread: one 0, two each 1–9', () => {
    for (const color of COLORS) {
      const nums = deck.filter((c): c is NumberCard => c.kind === 'number' && c.color === color)
      expect(nums.filter((c) => c.value === 0)).toHaveLength(1)
      for (let v = 1; v <= 9; v++) expect(nums.filter((c) => c.value === v)).toHaveLength(2)
    }
  })
  it('has two each of Skip/Reverse/Draw-2 per color', () => {
    for (const color of COLORS) {
      for (const kind of ['skip', 'reverse', 'draw2'] as const) {
        expect(deck.filter((c) => c.kind === kind && c.color === color)).toHaveLength(2)
      }
    }
  })
  it('has four Wild and four Wild-Draw-4, all color-less', () => {
    const wilds = deck.filter((c) => c.kind === 'wild')
    const w4s = deck.filter((c) => c.kind === 'wild4')
    expect(wilds).toHaveLength(4)
    expect(w4s).toHaveLength(4)
    expect([...wilds, ...w4s].every((c) => c.color === null)).toBe(true)
  })
})

describe('shuffle', () => {
  it('is a permutation — same multiset, reordered', () => {
    const src = makeDeck()
    const out = shuffle(src, mulberry32(1))
    expect(out).toHaveLength(src.length)
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(src.map((c) => c.id)))
  })
  it('is deterministic for a fixed rng and does not mutate the input', () => {
    const src = makeDeck()
    const before = src.map((c) => c.id)
    const a = shuffle(src, mulberry32(7)).map((c) => c.id)
    const b = shuffle(src, mulberry32(7)).map((c) => c.id)
    expect(a).toEqual(b)
    expect(src.map((c) => c.id)).toEqual(before) // input untouched
  })
})

describe('createGame', () => {
  it('deals 7 to every player and opens on a non-wild, color set from it', () => {
    const g = createGame(4, mulberry32(3))
    expect(handCounts(g)).toEqual([7, 7, 7, 7])
    const top = topCard(g)
    expect(top.kind === 'wild' || top.kind === 'wild4').toBe(false)
    expect(g.currentColor).toBe(top.color)
    expect(g.turn).toBe(0)
    expect(g.direction).toBe(1)
    expect(g.pendingDraw).toBe(0)
    expect(winnerOf(g)).toBeNull()
  })
  it('conserves all 108 cards across hands, stock and discard', () => {
    const g = createGame(5, mulberry32(9))
    const total = g.players.reduce((s, h) => s + h.length, 0) + g.drawPile.length + g.discard.length
    expect(total).toBe(DECK_SIZE)
    expect(g.players).toHaveLength(5)
    expect(g.drawPile.length).toBe(DECK_SIZE - 5 * HAND_SIZE - 1)
  })
  it('clamps a nonsensical player count into range', () => {
    expect(createGame(1, mulberry32(1)).players).toHaveLength(PLAYER_MIN)
    expect(createGame(99, mulberry32(1)).players).toHaveLength(PLAYER_MAX)
    expect(createGame(0, mulberry32(1)).players).toHaveLength(4) // 0 → default 4
  })
})

describe('requiredDifficulty', () => {
  it('tags number cards easy and every action/wild card hard', () => {
    expect(requiredDifficulty(num('red', 5))).toBe('easy')
    for (const c of [skip('red'), rev('red'), d2('red'), wild(), w4()]) {
      expect(requiredDifficulty(c)).toBe('hard')
    }
  })
})

describe('legalPlays / playability', () => {
  const top = num('red', 5)
  const base = (hand: Card[]) => mk({ players: [hand], discard: [top], currentColor: 'red' })
  it('accepts a same-color card', () => {
    const c = num('red', 8)
    expect(legalPlays(base([c]), 0)).toEqual([c])
  })
  it('accepts a same-number card of another color', () => {
    const c = num('blue', 5)
    expect(legalPlays(base([c]), 0)).toEqual([c])
  })
  it('accepts a matching action kind regardless of color', () => {
    const g = mk({ players: [[d2('blue')]], discard: [d2('red')], currentColor: 'red' })
    expect(legalPlays(g, 0)).toHaveLength(1)
  })
  it('always accepts wild and wild4', () => {
    expect(legalPlays(base([wild(), w4()]), 0)).toHaveLength(2)
  })
  it('rejects a mismatched color+number', () => {
    expect(legalPlays(base([num('blue', 3)]), 0)).toEqual([])
  })
})

describe('playCard — guards', () => {
  const g = mk({ players: [[num('red', 5)], [num('red', 1)]], discard: [num('red', 9)], turn: 0 })
  it('is illegal off-turn', () => {
    expect(playCard(g, 1, g.players[1][0], true, noRng).outcome).toBe('illegal')
  })
  it('is illegal for a card not in hand', () => {
    expect(playCard(g, 0, num('red', 2), true, noRng).outcome).toBe('illegal')
  })
  it('is illegal for an unplayable card', () => {
    const g2 = mk({ players: [[num('blue', 3)]], discard: [num('red', 9)] })
    expect(playCard(g2, 0, g2.players[0][0], true, noRng).outcome).toBe('illegal')
  })
  it('is illegal to play a wild without choosing a color', () => {
    const g2 = mk({ players: [[wild()]], discard: [num('red', 9)] })
    expect(playCard(g2, 0, g2.players[0][0], true, noRng).outcome).toBe('illegal')
  })
  it('is illegal while a penalty is pending (use stackOrTake)', () => {
    const g2 = mk({ players: [[num('red', 5)]], discard: [num('red', 9)], pendingDraw: 2, pendingKind: 'draw2' })
    expect(playCard(g2, 0, g2.players[0][0], true, noRng).outcome).toBe('illegal')
  })
  it('does not mutate the input state', () => {
    playCard(g, 0, g.players[0][0], true, noRng)
    expect(g.players[0]).toHaveLength(1)
    expect(g.discard).toHaveLength(1)
    expect(g.turn).toBe(0)
  })
})

describe('playCard — effects', () => {
  it('forfeits on a wrong answer: card stays, draw 1, turn passes', () => {
    const g = mk({ players: [[num('red', 5)], []], drawPile: [num('blue', 1)], discard: [num('red', 9)], turn: 0 })
    const r = playCard(g, 0, g.players[0][0], false, seqRng(0))
    expect(r.outcome).toBe('forfeit')
    expect(r.state.players[0]).toHaveLength(2) // kept the card, drew one
    expect(r.state.discard).toHaveLength(1) // nothing played
    expect(r.state.turn).toBe(1)
  })
  it('a number card just advances the turn', () => {
    const g = mk({ players: [[num('red', 5), wild()], [], []], discard: [num('red', 9)], turn: 0 })
    const r = playCard(g, 0, g.players[0][0], true, noRng)
    expect(r.outcome).toBe('played')
    expect(topCard(r.state)).toEqual(g.players[0][0])
    expect(r.state.turn).toBe(1)
  })
  it('skip jumps the next player (advance two)', () => {
    const g = mk({ players: [[skip('red'), wild()], [], []], discard: [num('red', 9)], turn: 0 })
    expect(playCard(g, 0, g.players[0][0], true, noRng).state.turn).toBe(2)
  })
  it('reverse flips direction and advances one with 3+ players', () => {
    const g = mk({ players: [[rev('red'), wild()], [], []], discard: [num('red', 9)], turn: 0, direction: 1 })
    const r = playCard(g, 0, g.players[0][0], true, noRng)
    expect(r.state.direction).toBe(-1)
    expect(r.state.turn).toBe(2) // one seat in the new (-1) direction from 0
  })
  it('reverse acts as a skip with exactly two players', () => {
    const g = mk({ players: [[rev('red'), wild()], []], discard: [num('red', 9)], turn: 0, direction: 1 })
    const r = playCard(g, 0, g.players[0][0], true, noRng)
    expect(r.state.direction).toBe(-1)
    expect(r.state.turn).toBe(0) // comes straight back to the same player
  })
  it('draw2 opens a 2-card penalty on the next player and passes to them', () => {
    const g = mk({ players: [[d2('red'), wild()], [], []], discard: [num('red', 9)], turn: 0 })
    const r = playCard(g, 0, g.players[0][0], true, noRng)
    expect(r.state.pendingDraw).toBe(2)
    expect(r.state.pendingKind).toBe('draw2')
    expect(r.state.turn).toBe(1)
  })
  it('wild4 sets the chosen color and opens a 4-card penalty', () => {
    const g = mk({ players: [[w4(), wild()], [], []], discard: [num('red', 9)], turn: 0 })
    const r = playCard(g, 0, g.players[0][0], true, noRng, 'blue')
    expect(r.state.currentColor).toBe('blue')
    expect(r.state.pendingDraw).toBe(4)
    expect(r.state.pendingKind).toBe('wild4')
    expect(r.state.turn).toBe(1)
  })
  it('wins when the last card leaves the hand', () => {
    const g = mk({ players: [[num('red', 5)], []], discard: [num('red', 9)], turn: 0 })
    const r = playCard(g, 0, g.players[0][0], true, noRng)
    expect(r.outcome).toBe('win')
    expect(winnerOf(r.state)).toBe(0)
  })
  it('is illegal once the game already has a winner', () => {
    const g = mk({ players: [[num('red', 5)]], discard: [num('red', 9)], winner: 1 })
    expect(playCard(g, 0, g.players[0][0], true, noRng).outcome).toBe('illegal')
  })
})

describe('stackOrTake', () => {
  // Player 1 owes a 2-card draw2 penalty and is to move.
  const pending = (hand: Card[]) => mk({
    players: [[], hand, [], []], discard: [d2('red')], currentColor: 'red',
    turn: 1, pendingDraw: 2, pendingKind: 'draw2', drawPile: [num('blue', 1), num('blue', 2), num('blue', 3)],
  })
  it('is illegal with no penalty pending', () => {
    const g = mk({ players: [[num('red', 1)]], discard: [num('red', 9)] })
    expect(stackOrTake(g, 0, g.players[0][0], true, noRng).outcome).toBe('illegal')
  })
  it('stacks a matching card: penalty grows and passes on, stacker unpenalized', () => {
    const card = d2('green')
    const g = pending([card, num('red', 4)])
    const r = stackOrTake(g, 1, card, true, noRng)
    expect(r.outcome).toBe('stacked')
    expect(r.state.pendingDraw).toBe(4) // 2 + 2
    expect(r.state.players[1]).toHaveLength(1) // shed the draw2, drew nothing
    expect(r.state.turn).toBe(2) // penalty passed to the next player
    expect(r.state.currentColor).toBe('green')
  })
  it('takes the full penalty on a wrong solve: draw the stack, turn skipped', () => {
    const card = d2('green')
    const g = pending([card])
    const r = stackOrTake(g, 1, card, false, seqRng(0))
    expect(r.outcome).toBe('took')
    expect(r.state.players[1]).toHaveLength(1 + 2) // kept its card, drew 2
    expect(r.state.pendingDraw).toBe(0)
    expect(r.state.turn).toBe(2) // skipped past the taker
  })
  it('takes when choosing to (card null), even holding a stackable card', () => {
    const g = pending([d2('green')])
    const r = stackOrTake(g, 1, null, true, seqRng(0))
    expect(r.outcome).toBe('took')
    expect(r.state.players[1]).toHaveLength(3)
  })
  it('cannot stack a non-matching card — it becomes a take', () => {
    const g = mk({
      players: [[], [num('blue', 5)], []], discard: [d2('red')], currentColor: 'red',
      turn: 1, pendingDraw: 2, pendingKind: 'draw2', drawPile: [num('blue', 1), num('blue', 2)],
    })
    const r = stackOrTake(g, 1, g.players[1][0], true, seqRng(0))
    expect(r.outcome).toBe('took')
    expect(r.state.players[1]).toHaveLength(3) // kept the number + drew 2
  })
  it('wins by shedding the last card as a stack', () => {
    const card = d2('green')
    const g = pending([card])
    const r = stackOrTake(g, 1, card, true, noRng)
    expect(r.outcome).toBe('win')
    expect(winnerOf(r.state)).toBe(1)
  })
  it('accumulates wild4 penalties strictly like-on-like', () => {
    const w = w4()
    const g = mk({
      players: [[], [w, num('blue', 1)], [], []], discard: [w4()], currentColor: 'red',
      turn: 1, pendingDraw: 4, pendingKind: 'wild4',
    })
    const r = stackOrTake(g, 1, w, true, noRng, 'green')
    expect(r.outcome).toBe('stacked')
    expect(r.state.pendingDraw).toBe(8)
    expect(r.state.currentColor).toBe('green')
  })
  it('does not mutate the input state', () => {
    const card = d2('green')
    const g = pending([card])
    stackOrTake(g, 1, card, true, noRng)
    expect(g.players[1]).toHaveLength(1)
    expect(g.pendingDraw).toBe(2)
  })
})

describe('drawToPlay', () => {
  it('is illegal while a penalty is pending', () => {
    const g = mk({ players: [[num('red', 1)]], discard: [num('red', 9)], pendingDraw: 2, pendingKind: 'draw2' })
    expect(drawToPlay(g, 0, true, seqRng(0)).outcome).toBe('illegal')
  })
  it('draws one on a correct solve; keeps the turn when it is playable', () => {
    const g = mk({ players: [[], []], drawPile: [num('red', 3)], discard: [num('red', 9)], currentColor: 'red', turn: 0 })
    const r = drawToPlay(g, 0, true, seqRng(0))
    expect(r.outcome).toBe('drew-playable')
    expect(r.playableDrawn?.kind).toBe('number')
    expect(r.state.turn).toBe(0) // stays so the caller can play it on the same solve
    expect(r.state.players[0]).toHaveLength(1)
  })
  it('draws one on a correct solve; passes the turn when it is not playable', () => {
    const g = mk({ players: [[], []], drawPile: [num('blue', 3)], discard: [num('red', 9)], currentColor: 'red', turn: 0 })
    const r = drawToPlay(g, 0, true, seqRng(0))
    expect(r.outcome).toBe('drew-pass')
    expect(r.playableDrawn).toBeNull()
    expect(r.state.turn).toBe(1)
  })
  it('draws two and skips on a wrong solve', () => {
    const g = mk({ players: [[], []], drawPile: [num('blue', 3), num('blue', 4)], discard: [num('red', 9)], turn: 0 })
    const r = drawToPlay(g, 0, false, seqRng(0))
    expect(r.outcome).toBe('drew-forfeit')
    expect(r.state.players[0]).toHaveLength(2)
    expect(r.state.turn).toBe(1)
  })
})

describe('reshuffle when the stock runs dry', () => {
  it('folds the discard (all but its top) back into the draw pile', () => {
    // Empty stock, a discard we can recycle. Drawn cards are unplayable → the
    // turn passes and we can inspect the rebuilt piles.
    const top = num('red', 9)
    const a = num('blue', 3)
    const b = num('green', 4)
    const g = mk({ players: [[], []], drawPile: [], discard: [a, b, top], currentColor: 'red', turn: 0 })
    const r = drawToPlay(g, 0, true, seqRng(0))
    expect(r.state.players[0]).toHaveLength(1) // successfully drew after reshuffle
    expect(r.state.discard).toEqual([top]) // only the top survives
    expect(r.state.drawPile).toHaveLength(1) // the other recycled card, minus the draw
    const survivors = [...r.state.players[0], ...r.state.drawPile].map((c) => c.id).sort()
    expect(survivors).toEqual([a.id, b.id].sort()) // a and b conserved, nothing lost
  })
})

describe('aiChoose', () => {
  it('stacks a matching card when a penalty is pending', () => {
    const card = d2('green')
    const g = mk({
      players: [[], [card, num('red', 1)], [], []], discard: [d2('red')], currentColor: 'red',
      turn: 1, pendingDraw: 2, pendingKind: 'draw2',
    })
    const { action } = aiChoose(g, 1, seqRng(0))
    expect(action.kind).toBe('stack')
    expect(action.kind === 'stack' && action.card.id).toBe(card.id)
  })
  it('takes when it cannot stack a pending penalty', () => {
    const g = mk({
      players: [[], [num('red', 1)], [], []], discard: [d2('red')], currentColor: 'red',
      turn: 1, pendingDraw: 2, pendingKind: 'draw2',
    })
    expect(aiChoose(g, 1, seqRng(0)).action.kind).toBe('take')
  })
  it('prefers shedding an action card over a low number', () => {
    const g = mk({ players: [[num('red', 2), skip('red')]], discard: [num('red', 9)], currentColor: 'red', turn: 0 })
    const { action } = aiChoose(g, 0, seqRng(0))
    expect(action.kind === 'play' && action.card.kind).toBe('skip')
  })
  it('declares its most-held color for a wild', () => {
    const hand = [wild(), num('blue', 1), num('blue', 2), num('green', 3)]
    const g = mk({ players: [hand], discard: [num('red', 9)], currentColor: 'red', turn: 0 })
    const { action } = aiChoose(g, 0, seqRng(0.99)) // only the wild is legal
    expect(action.kind === 'play' && action.chosenColor).toBe('blue')
  })
  it('draws when it holds no legal play', () => {
    const g = mk({ players: [[num('blue', 3)]], discard: [num('red', 9)], currentColor: 'red', turn: 0 })
    expect(aiChoose(g, 0, seqRng(0)).action.kind).toBe('draw')
  })
})

describe('aiSolves / aiCorrectRate', () => {
  it('solves iff the roll is below the rate', () => {
    expect(aiSolves(seqRng(0.4), 0.5)).toBe(true)
    expect(aiSolves(seqRng(0.6), 0.5)).toBe(false)
  })
  it('spreads rivals and keeps every rate a valid probability', () => {
    expect(aiCorrectRate(0)).toBeGreaterThan(aiCorrectRate(3)) // rival 0 is the sharpest
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (let i = 0; i < 4; i++) {
        const r = aiCorrectRate(i, d)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThanOrEqual(1)
      }
    }
  })
  it('makes a harder topic field sharper rivals', () => {
    expect(aiCorrectRate(0, 'hard')).toBeGreaterThan(aiCorrectRate(0, 'easy'))
  })
})

describe('nextPlayer', () => {
  it('reports the seat that moves next in the current direction', () => {
    const g = mk({ players: [[], [], []], discard: [num('red', 9)], turn: 0, direction: 1 })
    expect(nextPlayer(g)).toBe(1)
    expect(nextPlayer({ ...g, direction: -1 })).toBe(2) // wraps backward
  })
})
