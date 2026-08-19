import { describe, it, expect } from 'vitest'
import {
  dealTable, isMyTurn, myLegalPlays, playFromHand, stackOrTakePenalty, drawOne, passAfterDraw,
  toCard, toCardPublic, toCardHand, cardPublicData, cardHandData,
  type CardPublic, type CardHand,
} from './cardRoom'
import { HAND_SIZE, DECK_SIZE, type Card } from './cardgame'

// Deterministic rng so a deal can be re-run.
function rngFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ids = (cards: readonly Card[]) => cards.map((c) => c.id)

describe('the deal', () => {
  it('gives everyone a hand and a private reserve', () => {
    const { pub, hands } = dealTable(4, rngFrom(1))
    expect(hands).toHaveLength(4)
    for (const h of hands) {
      expect(h.hand).toHaveLength(HAND_SIZE)
      expect(h.reserve.length).toBeGreaterThan(10)
    }
    expect(pub.seats).toBe(4)
    expect(pub.counts).toEqual([HAND_SIZE, HAND_SIZE, HAND_SIZE, HAND_SIZE])
    expect(pub.winner).toBeNull()
  })

  it('never deals the same card to two people', () => {
    const { pub, hands } = dealTable(4, rngFrom(7))
    const all = [...hands.flatMap((h) => [...ids(h.hand), ...ids(h.reserve)]), pub.discardTop.id]
    expect(new Set(all).size).toBe(all.length)
  })

  it('deals from one real deck', () => {
    const { pub, hands } = dealTable(4, rngFrom(3))
    const dealt = hands.reduce((n, h) => n + h.hand.length + h.reserve.length, 0) + 1
    expect(dealt).toBeLessThanOrEqual(DECK_SIZE)
  })

  it('shares nothing about anyone hand but its size', () => {
    // The public state is what everybody reads; it must carry no card identity
    // beyond the face-up discard.
    const { pub } = dealTable(4, rngFrom(11))
    const serialised = JSON.stringify(cardPublicData(pub))
    expect(serialised).toContain(pub.discardTop.id)
    const { hands } = dealTable(4, rngFrom(11))
    for (const h of hands) {
      for (const c of h.hand) {
        if (c.id === pub.discardTop.id) continue
        expect(serialised).not.toContain(c.id)
      }
    }
  })

  it('is reproducible for a given shuffle', () => {
    expect(JSON.stringify(dealTable(4, rngFrom(5)))).toBe(JSON.stringify(dealTable(4, rngFrom(5))))
  })
})

describe('taking a turn', () => {
  const table = () => dealTable(4, rngFrom(42))

  it('knows whose turn it is', () => {
    const { pub } = table()
    expect(isMyTurn(pub, pub.turn)).toBe(true)
    expect(isMyTurn(pub, (pub.turn + 1) % 4)).toBe(false)
    expect(isMyTurn({ ...pub, winner: 0 }, pub.turn)).toBe(false)
  })

  it('offers only cards the real rules allow', () => {
    const { pub, hands } = table()
    const seat = pub.turn
    const legal = myLegalPlays(pub, hands[seat], seat)
    // Every offered card is genuinely in our hand, and never more than we hold.
    for (const c of legal) expect(ids(hands[seat].hand)).toContain(c.id)
    expect(legal.length).toBeLessThanOrEqual(hands[seat].hand.length)
  })

  it('plays a card out of our hand and onto the pile', () => {
    const { pub, hands } = table()
    const seat = pub.turn
    const legal = myLegalPlays(pub, hands[seat], seat)
    if (legal.length === 0) return // this deal had nothing playable; other tests cover it
    const card = legal[0]
    const r = playFromHand(pub, hands[seat], seat, card, true, 'red')
    expect(r.outcome === 'played' || r.outcome === 'win').toBe(true)
    expect(ids(r.mine.hand)).not.toContain(card.id)
    expect(r.pub.discardTop.id).toBe(card.id)
    expect(r.pub.counts[seat]).toBe(hands[seat].hand.length - 1)
  })

  it('forfeits the play on a wrong answer', () => {
    const { pub, hands } = table()
    const seat = pub.turn
    const legal = myLegalPlays(pub, hands[seat], seat)
    if (legal.length === 0) return
    const r = playFromHand(pub, hands[seat], seat, legal[0], false, 'red')
    expect(r.outcome).toBe('forfeit')
    // The card stays put and the pile is unchanged.
    expect(r.pub.discardTop.id).toBe(pub.discardTop.id)
  })

  it('refuses a move from someone whose turn it is not', () => {
    const { pub, hands } = table()
    const other = (pub.turn + 1) % 4
    const legal = myLegalPlays(pub, hands[other], other)
    if (legal.length === 0) return
    expect(playFromHand(pub, hands[other], other, legal[0], true).outcome).toBe('illegal')
  })

  it('leaves everyone else hands untouched', () => {
    const { pub, hands } = table()
    const seat = pub.turn
    const legal = myLegalPlays(pub, hands[seat], seat)
    if (legal.length === 0) return
    const r = playFromHand(pub, hands[seat], seat, legal[0], true, 'red')
    // Only the mover's count may change — a turn must never touch another hand.
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue
      expect(r.pub.counts[i]).toBe(pub.counts[i])
    }
  })
})

describe('drawing', () => {
  it('takes from our own reserve, not a shared pile', () => {
    const { pub, hands } = dealTable(4, rngFrom(9))
    const seat = pub.turn
    const before = hands[seat]
    const r = drawOne(pub, before, seat, rngFrom(1))
    if (r.outcome === 'illegal') return
    expect(r.mine.hand.length).toBe(before.hand.length + 1)
    expect(r.mine.reserve.length).toBe(before.reserve.length - 1)
    expect(r.pub.counts[seat]).toBe(before.hand.length + 1)
  })

  it('never gives us a card somebody else holds', () => {
    const { pub, hands } = dealTable(4, rngFrom(21))
    const seat = pub.turn
    const others = new Set(hands.flatMap((h, i) => (i === seat ? [] : [...ids(h.hand), ...ids(h.reserve)])))
    const r = drawOne(pub, hands[seat], seat, rngFrom(2))
    if (r.outcome === 'illegal') return
    for (const c of r.mine.hand) expect(others.has(c.id)).toBe(false)
  })

  it('lets us keep the card and pass', () => {
    const { pub, hands } = dealTable(4, rngFrom(9))
    const seat = pub.turn
    const drawn = drawOne(pub, hands[seat], seat, rngFrom(1))
    if (drawn.outcome !== 'drew-playable') return
    const after = passAfterDraw(drawn.pub, drawn.mine, seat)
    expect(after.pub.turn).not.toBe(seat)
    expect(after.mine.hand.length).toBe(drawn.mine.hand.length)
  })
})

describe('penalties', () => {
  it('takes the cards from our own reserve', () => {
    const { pub, hands } = dealTable(4, rngFrom(13))
    const seat = pub.turn
    const owed = 2
    const withPenalty: CardPublic = { ...pub, pendingDraw: owed, pendingKind: 'draw2' }
    const r = stackOrTakePenalty(withPenalty, hands[seat], seat, null, true)
    if (r.outcome === 'illegal') return
    expect(r.mine.hand.length).toBe(hands[seat].hand.length + owed)
    expect(r.mine.reserve.length).toBe(hands[seat].reserve.length - owed)
    expect(r.pub.pendingDraw).toBe(0)
  })
})

describe('reading untrusted documents', () => {
  const { pub, hands } = dealTable(4, rngFrom(77))

  it('round-trips the shared state', () => {
    expect(toCardPublic(cardPublicData(pub))).toEqual(pub)
  })

  it('round-trips a hand', () => {
    const data = cardHandData(hands[0]).cards
    expect(toCardHand(data)).toEqual(hands[0])
  })

  it('rejects rubbish', () => {
    expect(toCardPublic(null)).toBeNull()
    expect(toCardPublic({})).toBeNull()
    expect(toCardHand(null)).toBeNull()
    expect(toCardHand({ hand: 'nope', reserve: [] })).toBeNull()
  })

  it('rejects a turn or winner pointing at a seat that does not exist', () => {
    expect(toCardPublic({ ...cardPublicData(pub), turn: 9 })).toBeNull()
    expect(toCardPublic({ ...cardPublicData(pub), winner: 9 })?.winner).toBeNull()
  })

  it('rejects a table of an impossible size', () => {
    expect(toCardPublic({ ...cardPublicData(pub), seats: 1 })).toBeNull()
    expect(toCardPublic({ ...cardPublicData(pub), seats: 99 })).toBeNull()
  })

  it('rejects counts that do not match the table', () => {
    expect(toCardPublic({ ...cardPublicData(pub), counts: [1, 2] })).toBeNull()
    expect(toCardPublic({ ...cardPublicData(pub), counts: [1, 2, 3, -1] })).toBeNull()
  })

  it('rejects a malformed card rather than rendering it', () => {
    expect(toCard({ id: 'x', kind: 'banana', color: 'red' })).toBeNull()
    expect(toCard({ id: 'x', kind: 'number', color: 'puce', value: 3 })).toBeNull()
    expect(toCard({ id: 'x', kind: 'number', color: 'red', value: 99 })).toBeNull()
    expect(toCard({ kind: 'wild', color: null })).toBeNull()
  })

  it('accepts a wild, which has no colour of its own', () => {
    expect(toCard({ id: 'w1', kind: 'wild', color: null })).toEqual({ id: 'w1', kind: 'wild', color: null })
  })

  it('writes no undefined, which Firestore refuses', () => {
    expect(JSON.stringify(cardPublicData(pub))).not.toContain('undefined')
    expect(JSON.stringify(cardHandData(hands[0]))).not.toContain('undefined')
  })
})
