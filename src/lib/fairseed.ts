// A shuffle nobody controls.
//
// Anything random in an online game has to come from somewhere, and with no
// server the obvious answers are all bad: if one player picks it they can pick a
// good one, and if it is derived from something visible everyone can see it
// coming.
//
// Commit-reveal solves the first half. Every player picks a secret, and first
// publishes only a HASH of it. Once all the hashes are in, everyone reveals.
// Because a hash cannot be worked backwards and cannot be matched by a different
// secret, nobody could have chosen their secret knowing anyone else's — and the
// result mixes all of them, so no single player steers it. Any reveal that does
// not match its own commitment is caught by everyone at the table.
//
// What this does NOT do is hide the result afterwards: once revealed, every
// client can work out the whole sequence. That is fine for dice, where the
// cheat worth stopping is a player inventing their own roll. It is not enough to
// keep a card hand secret — see docs/multiplayer-rules.md.
//
// Pure apart from the platform's crypto, which is why the hashing is async.

/** One player's sealed contribution: the hash of a secret only they know yet. */
export interface Commitment { uid: string; hash: string }
/** The same player opening it, once every commitment is in. */
export interface Reveal { uid: string; secret: string }

const SECRET_BYTES = 16

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) {
    // Better to fail loudly than to quietly fall back to a weak hash that only
    // looks like a commitment.
    throw new Error('This browser cannot do the secure hashing a fair shuffle needs.')
  }
  return c.subtle
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/** A fresh secret for this player. Never shown until everyone has committed. */
export function randomSecret(): string {
  const c = globalThis.crypto
  if (!c?.getRandomValues) throw new Error('This browser cannot generate a secure random number.')
  return toHex(c.getRandomValues(new Uint8Array(SECRET_BYTES)))
}

/** The value a player publishes first — binding, but revealing nothing. */
export async function commit(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret)
  return toHex(new Uint8Array(await subtle().digest('SHA-256', data)))
}

/** Whether a revealed secret really is the one that was committed to. */
export async function verifyReveal(reveal: Reveal, commitments: readonly Commitment[]): Promise<boolean> {
  const theirs = commitments.find((c) => c.uid === reveal.uid)
  if (!theirs) return false
  return (await commit(reveal.secret)) === theirs.hash
}

/** Every reveal checked against its commitment. One bad opener fails the set. */
export async function allRevealsValid(
  reveals: readonly Reveal[], commitments: readonly Commitment[],
): Promise<boolean> {
  if (reveals.length !== commitments.length) return false
  for (const r of reveals) {
    if (!(await verifyReveal(r, commitments))) return false
  }
  return true
}

/**
 * The shared seed: every secret mixed together, in a fixed order so all clients
 * agree. Sorted by uid rather than arrival, because whoever revealed first must
 * not get to influence the ordering.
 */
export async function combineSeed(reveals: readonly Reveal[]): Promise<number> {
  const joined = [...reveals]
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
    .map((r) => `${r.uid}:${r.secret}`)
    .join('|')
  const digest = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(joined)))
  // 32 bits is plenty for a game seed and keeps it a safe integer.
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
}

// ---------------------------------------------------------------------------
// Deriving each turn's randomness from the shared seed
// ---------------------------------------------------------------------------

/** mulberry32 — the same small PRNG the Daily Challenge seeds itself with. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A stream of numbers for one turn, fixed by the shared seed and the turn
 * number. Every client can work out the same values, which is what lets them
 * check a published turn instead of taking it on trust.
 */
export function rngForTurn(seed: number, tick: number): () => number {
  // Mixing the tick in rather than advancing one long stream means a client can
  // check any single turn without replaying the game from the start.
  return mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(tick + 1, 0x85ebca6b)) >>> 0)
}
