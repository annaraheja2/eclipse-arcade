import { describe, it, expect } from 'vitest'
import { colorName, describeCard, cardGlyph, placementFor, cardGameScore, CARDGAME_WIN_SCORE } from './cardgameView'
import type { Card, Color } from './cardgame'

const num = (color: Color, value: number): Card => ({ kind: 'number', color, value, id: 'x' })

describe('describeCard / cardGlyph — labels for logs, aria, and card faces', () => {
  it('names colored cards with their color and value/action', () => {
    expect(describeCard(num('red', 7))).toBe('Red 7')
    expect(describeCard({ kind: 'skip', color: 'blue', id: 's' })).toBe('Blue Skip')
    expect(describeCard({ kind: 'reverse', color: 'green', id: 'r' })).toBe('Green Reverse')
    expect(describeCard({ kind: 'draw2', color: 'yellow', id: 'd' })).toBe('Yellow Draw Two')
  })

  it('appends the declared color to a wild only once one is chosen', () => {
    expect(describeCard({ kind: 'wild', color: null, id: 'w' })).toBe('Wild')
    expect(describeCard({ kind: 'wild', color: null, id: 'w' }, 'blue')).toBe('Wild (Blue)')
    expect(describeCard({ kind: 'wild4', color: null, id: 'w4' }, 'red')).toBe('Wild Draw Four (Red)')
  })

  it('gives a compact glyph for each kind', () => {
    expect(cardGlyph(num('green', 3))).toBe('3')
    expect(cardGlyph({ kind: 'draw2', color: 'red', id: 'd' })).toBe('+2')
    expect(cardGlyph({ kind: 'wild4', color: null, id: 'w' })).toBe('+4')
    expect(cardGlyph({ kind: 'wild', color: null, id: 'w' })).toBe('WILD')
  })

  it('capitalizes color names', () => {
    expect(colorName('red')).toBe('Red')
    expect(colorName('yellow')).toBe('Yellow')
  })
})

describe('placementFor — finishing place from final hand sizes', () => {
  it('puts the empty hand first', () => {
    expect(placementFor([0, 3, 5, 2], 0)).toBe(1)
  })
  it('counts only players with strictly fewer cards', () => {
    const counts = [0, 3, 5, 2]
    expect(placementFor(counts, 3)).toBe(2) // 2 cards, only the 0 is fewer
    expect(placementFor(counts, 1)).toBe(3) // 3 cards, 0 and 2 are fewer
    expect(placementFor(counts, 2)).toBe(4) // 5 cards, everyone else fewer
  })
  it('lets equal hand sizes share the higher place', () => {
    expect(placementFor([4, 4, 9], 0)).toBe(1)
    expect(placementFor([4, 4, 9], 1)).toBe(1)
    expect(placementFor([4, 4, 9], 2)).toBe(3)
  })
})

describe('cardGameScore — placement + shedding reward', () => {
  it('tops out for a clean 4-player win and floors for last place', () => {
    expect(cardGameScore(1, 4, 0)).toBe(300 + CARDGAME_WIN_SCORE + 600) // 3900
    expect(cardGameScore(4, 4, 30)).toBe(300) // last, over the card cap → floor
  })

  it('is monotonic: a better placement never scores less', () => {
    const held = 5
    const s1 = cardGameScore(1, 4, held)
    const s2 = cardGameScore(2, 4, held)
    const s3 = cardGameScore(3, 4, held)
    const s4 = cardGameScore(4, 4, held)
    expect(s1).toBeGreaterThan(s2)
    expect(s2).toBeGreaterThan(s3)
    expect(s3).toBeGreaterThan(s4)
  })

  it('rewards shedding: fewer cards left never scores less at the same placement', () => {
    expect(cardGameScore(3, 4, 2)).toBeGreaterThan(cardGameScore(3, 4, 12))
    expect(cardGameScore(3, 4, 25)).toBe(cardGameScore(3, 4, 40)) // both past the cap → equal
  })

  it('clamps nonsensical inputs instead of returning NaN or negatives', () => {
    expect(cardGameScore(0, 1, -5)).toBeGreaterThanOrEqual(300)
    expect(Number.isFinite(cardGameScore(99, 2, 0))).toBe(true)
    expect(cardGameScore(99, 2, 0)).toBe(900) // placement clamped to last of 2; empty hand keeps its shed bonus
  })
})
