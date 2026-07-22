import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { getFirebaseDb } from './firebase'
import { useAuth } from './auth'

export interface PlayerState {
  coins: number
  xp: number
  streak: number
  lastPlayed: string // yyyy-mm-dd
  bests: Record<string, number> // gameKey -> best total score
}

const KEY = 'eclipse-arcade:player'
const XP_PER_LEVEL = 500

const DEFAULT: PlayerState = { coins: 0, xp: 0, streak: 0, lastPlayed: '', bests: {} }

function load(): PlayerState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT }
  } catch { return { ...DEFAULT } }
}
function save(p: PlayerState) { localStorage.setItem(KEY, JSON.stringify(p)) }

// Date boundary + pure calendar helpers (yyyy-mm-dd, UTC).
export function todayStr(): string { return new Date().toISOString().slice(0, 10) }
export function prevDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// A streak is at risk when the player has an active streak (last played yesterday)
// but hasn't played today yet — one skipped day resets it.
export function isStreakAtRisk(lastPlayed: string, today: string): boolean {
  return lastPlayed !== '' && lastPlayed === prevDay(today)
}

function today(): string { return todayStr() }
function yesterday(): string { return prevDay(todayStr()) }

export function levelFromXp(xp: number) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1
  const into = xp % XP_PER_LEVEL
  return { level, into, pct: Math.round((into / XP_PER_LEVEL) * 100) }
}

// Reward math: a 5000-point round → ~500 XP (a full level) + ~250 coins.
export function rewardsFor(score: number) {
  return { xp: Math.round(score / 10), coins: Math.round(score / 20) }
}

// Reconciles local and cloud copies of the same player, generously: totals and
// streak take the max, bests take the per-game max, lastPlayed the later date
// (yyyy-mm-dd compares lexicographically; '' sorts first). Pure — unit-tested.
export function mergePlayerState(local: PlayerState, cloud: PlayerState): PlayerState {
  const bests: Record<string, number> = { ...cloud.bests }
  for (const [k, v] of Object.entries(local.bests)) {
    bests[k] = Math.max(bests[k] ?? 0, v)
  }
  return {
    coins: Math.max(local.coins, cloud.coins),
    xp: Math.max(local.xp, cloud.xp),
    streak: Math.max(local.streak, cloud.streak),
    lastPlayed: local.lastPlayed > cloud.lastPlayed ? local.lastPlayed : cloud.lastPlayed,
    bests,
  }
}

// Firestore docs are untrusted input — narrow to a well-formed PlayerState.
// Exported for tests. lastPlayed feeds lexicographic date comparison in
// mergePlayerState, where a malformed string like 'zzzz' would beat every real
// date forever and cap the streak — only yyyy-mm-dd is accepted.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function toPlayerState(data: unknown): PlayerState {
  if (typeof data !== 'object' || data === null) return { ...DEFAULT }
  const d = data as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const bests: Record<string, number> = {}
  if (typeof d.bests === 'object' && d.bests !== null) {
    for (const [k, v] of Object.entries(d.bests)) {
      if (typeof v === 'number' && Number.isFinite(v)) bests[k] = v
    }
  }
  return {
    coins: num(d.coins),
    xp: num(d.xp),
    streak: num(d.streak),
    lastPlayed: typeof d.lastPlayed === 'string' && DATE_RE.test(d.lastPlayed) ? d.lastPlayed : '',
    bests,
  }
}

// Firestore is loaded lazily (see lib/firebase.ts) — this helper pairs the SDK
// module with the initialized db so callers get both in one await.
async function firestoreSdk() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

// The players/{uid} doc mirrors PlayerState plus { email, updatedAt }.
async function writeCloud(user: User, state: PlayerState): Promise<void> {
  const { sdk, db } = await firestoreSdk()
  const ref = sdk.doc(db, 'players', user.uid)
  await sdk.setDoc(
    ref,
    { ...state, email: user.email, updatedAt: sdk.serverTimestamp() },
    { merge: true }
  )
}

interface Ctx {
  player: PlayerState
  finishGame: (gameKey: string, score: number) => { xp: number; coins: number; best: boolean }
}
const PlayerCtx = createContext<Ctx | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<PlayerState>(() => load())
  // Refs let finishGame stay identity-stable (it sits in effect deps downstream)
  // while still seeing the latest state and signed-in user.
  const playerRef = useRef(player)
  const { user } = useAuth()
  const userRef = useRef(user)
  userRef.current = user

  // Sign-out must not leak the previous account's merged state into whoever
  // signs in next on this browser — reset to DEFAULT on the signed-in →
  // signed-out transition. A device that was never signed in is unaffected.
  const wasSignedIn = useRef(false)
  useEffect(() => {
    if (user) {
      wasSignedIn.current = true
      return
    }
    if (!wasSignedIn.current) return
    wasSignedIn.current = false
    const next = { ...DEFAULT }
    playerRef.current = next
    setPlayer(next)
    save(next)
  }, [user])

  // On sign-in: seed players/{uid} from local state if it doesn't exist yet;
  // otherwise merge cloud into local, adopt the result, and write it back.
  // Signed out or unconfigured, user is always null and this never runs.
  useEffect(() => {
    if (!user) return
    let stale = false
    const sync = async () => {
      const { sdk, db } = await firestoreSdk()
      const ref = sdk.doc(db, 'players', user.uid)
      const snap = await sdk.getDoc(ref)
      // The user changed (or signed out) mid-fetch — a cancelled sync must
      // adopt nothing and write nothing, especially not to the old uid's doc.
      if (stale) return
      let next = playerRef.current
      if (snap.exists()) {
        next = mergePlayerState(playerRef.current, toPlayerState(snap.data()))
        playerRef.current = next
        setPlayer(next)
        save(next)
      }
      await sdk.setDoc(
        ref,
        { ...next, email: user.email, updatedAt: sdk.serverTimestamp() },
        { merge: true }
      )
    }
    sync().catch((err: unknown) => console.error('[eclipse-arcade] cloud sync failed:', err))
    return () => { stale = true }
  }, [user])

  const finishGame = useCallback((gameKey: string, score: number) => {
    const { xp, coins } = rewardsFor(score)
    const prev = playerRef.current
    const t = today()
    let streak = prev.streak
    if (prev.lastPlayed !== t) {
      streak = prev.lastPlayed === yesterday() ? prev.streak + 1 : 1
    }
    const prevBest = prev.bests[gameKey] ?? 0
    const next: PlayerState = {
      coins: prev.coins + coins,
      xp: prev.xp + xp,
      streak,
      lastPlayed: t,
      bests: { ...prev.bests, [gameKey]: Math.max(prevBest, score) },
    }
    playerRef.current = next
    setPlayer(next)
    save(next)
    // Write-through to Firestore while signed in — fire-and-forget, but never
    // silent: a failed save must be visible in the console.
    const u = userRef.current
    if (u) {
      writeCloud(u, next).catch((err: unknown) =>
        console.error('[eclipse-arcade] cloud save failed:', err))
    }
    return { xp, coins, best: score > prevBest }
  }, [])

  return <PlayerCtx.Provider value={{ player, finishGame }}>{children}</PlayerCtx.Provider>
}

export function usePlayer(): Ctx {
  const c = useContext(PlayerCtx)
  if (!c) throw new Error('usePlayer must be used within PlayerProvider')
  return c
}
