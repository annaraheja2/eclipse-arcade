import { describe, it, expect } from 'vitest'
import {
  randomSecret, commit, verifyReveal, allRevealsValid, combineSeed, rngForTurn,
  type Commitment, type Reveal,
} from './fairseed'

const sealed = async (uid: string, secret: string): Promise<[Commitment, Reveal]> =>
  [{ uid, hash: await commit(secret) }, { uid, secret }]

describe('secrets and commitments', () => {
  it('makes a different secret every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomSecret()))
    expect(seen.size).toBe(50)
  })

  it('commits to the same hash for the same secret', async () => {
    expect(await commit('abc')).toBe(await commit('abc'))
  })

  it('gives different secrets different hashes', async () => {
    expect(await commit('abc')).not.toBe(await commit('abd'))
  })

  it('reveals nothing about the secret', async () => {
    const secret = randomSecret()
    expect(await commit(secret)).not.toContain(secret)
  })
})

describe('opening a commitment', () => {
  it('accepts the secret that was committed to', async () => {
    const [c, r] = await sealed('anna', 'my-secret')
    expect(await verifyReveal(r, [c])).toBe(true)
  })

  it('catches a player who changes their mind', async () => {
    const [c] = await sealed('anna', 'my-secret')
    // Committed to one number, tried to open with a better one.
    expect(await verifyReveal({ uid: 'anna', secret: 'a-nicer-number' }, [c])).toBe(false)
  })

  it('catches a reveal from someone who never committed', async () => {
    const [c] = await sealed('anna', 's')
    expect(await verifyReveal({ uid: 'gatecrasher', secret: 's' }, [c])).toBe(false)
  })

  it('accepts a whole table that played straight', async () => {
    const pairs = await Promise.all([sealed('a', '1'), sealed('b', '2'), sealed('c', '3')])
    const commitments = pairs.map((p) => p[0])
    const reveals = pairs.map((p) => p[1])
    expect(await allRevealsValid(reveals, commitments)).toBe(true)
  })

  it('fails the whole set when one player cheats', async () => {
    const pairs = await Promise.all([sealed('a', '1'), sealed('b', '2'), sealed('c', '3')])
    const commitments = pairs.map((p) => p[0])
    const reveals = pairs.map((p) => p[1])
    reveals[1] = { uid: 'b', secret: 'something-else' }
    expect(await allRevealsValid(reveals, commitments)).toBe(false)
  })

  it('fails when somebody never opens theirs', async () => {
    const pairs = await Promise.all([sealed('a', '1'), sealed('b', '2')])
    expect(await allRevealsValid([pairs[0][1]], pairs.map((p) => p[0]))).toBe(false)
  })
})

describe('the shared seed', () => {
  const reveals: Reveal[] = [
    { uid: 'anna', secret: 'aaa' },
    { uid: 'alex', secret: 'bbb' },
    { uid: 'harish', secret: 'ccc' },
  ]

  it('is the same on every client', async () => {
    expect(await combineSeed(reveals)).toBe(await combineSeed(reveals))
  })

  it('does not depend on who revealed first', async () => {
    const shuffled = [reveals[2], reveals[0], reveals[1]]
    expect(await combineSeed(shuffled)).toBe(await combineSeed(reveals))
  })

  it('changes if any single player changes their secret', async () => {
    const base = await combineSeed(reveals)
    for (let i = 0; i < reveals.length; i++) {
      const tweaked = reveals.map((r, j) => (i === j ? { ...r, secret: 'zzz' } : r))
      expect(await combineSeed(tweaked)).not.toBe(base)
    }
  })

  it('is a usable 32-bit seed', async () => {
    const seed = await combineSeed(reveals)
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(2 ** 32)
  })
})

describe('per-turn randomness', () => {
  it('gives every client the same numbers for the same turn', () => {
    const a = rngForTurn(12345, 7)
    const b = rngForTurn(12345, 7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('gives different turns different numbers', () => {
    expect(rngForTurn(12345, 7)()).not.toBe(rngForTurn(12345, 8)())
  })

  it('gives different tables different numbers on the same turn', () => {
    expect(rngForTurn(1, 3)()).not.toBe(rngForTurn(2, 3)())
  })

  it('can be checked for one turn without replaying the game', () => {
    // Turn 40 is computable directly — no need to walk turns 0..39 first.
    expect(rngForTurn(999, 40)()).toBe(rngForTurn(999, 40)())
  })

  it('stays inside 0..1', () => {
    const rng = rngForTurn(42, 0)
    for (let i = 0; i < 200; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('spreads dice across all six faces', () => {
    const faces = new Set<number>()
    for (let tick = 0; tick < 200; tick++) {
      faces.add(1 + Math.min(5, Math.floor(rngForTurn(7, tick)() * 6)))
    }
    expect(faces).toEqual(new Set([1, 2, 3, 4, 5, 6]))
  })
})
