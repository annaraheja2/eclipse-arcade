import { describe, it, expect } from 'vitest'
import { buildShareCard } from './share'

describe('buildShareCard', () => {
  it('maps each round to a square by score threshold (green ≥780, blue ≥400, orange below)', () => {
    const card = buildShareCard('PinPoint', [900, 500, 100], 1500, 4)
    expect(card).toContain('🟩🟦🟧')
  })

  it('uses the exact boundary values (780 → green, 400 → blue, 399 → orange)', () => {
    expect(buildShareCard('X', [780], 780, 1)).toContain('🟩')
    expect(buildShareCard('X', [400], 400, 1)).toContain('🟦')
    expect(buildShareCard('X', [399], 399, 1)).toContain('🟧')
  })

  it('includes the game name, total out of max, and level tag', () => {
    const card = buildShareCard('Slider', [1000, 1000], 2000, 3)
    expect(card).toContain('Eclipse Arcade — Slider')
    expect(card).toContain('2000/2000')
    expect(card).toContain('LVL 3')
  })

  it('is spoiler-free — contains no answer coordinates or numbers beyond score/level', () => {
    const card = buildShareCard('PinPoint', [820, 610], 1430, 2)
    expect(card).not.toMatch(/Answer/i)
  })
})
