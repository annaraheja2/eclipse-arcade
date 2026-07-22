import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { getFirebaseDb } from './firebase'
import { useAuth } from './auth'
import { COURSE_LIST } from '../data/subjects'

export interface PlayerState {
  coins: number
  xp: number
  streak: number
  lastPlayed: string // yyyy-mm-dd
  bests: Record<string, number> // gameKey -> best total score
  gamesPlayed: number // cumulative count, max-merged like coins
  // Cumulative answer counters — NEVER store a ratio; accuracy() derives it for
  // display. Both max-merge (a wrong answer only ever raises `answered`).
  questionsAnswered: number
  questionsCorrect: number
  username?: string // display-case handle; server-reserved (see lib/username.ts)
  preferredCourseId?: string // vs-AI default course; cloud-preferred like username
  avatarColor?: string // one of AVATAR_COLORS; cloud-preferred like username
}

const KEY = 'eclipse-arcade:player'
const XP_PER_LEVEL = 500

const DEFAULT: PlayerState = {
  coins: 0, xp: 0, streak: 0, lastPlayed: '', bests: {},
  gamesPlayed: 0, questionsAnswered: 0, questionsCorrect: 0,
}

// The default math level (Algebra 1) and the neon accent palette an avatar may
// use (tailwind.config.js → colors.neon). Constraining avatars to this palette
// keeps every accent AA-legible on the #0a0620 field.
export const DEFAULT_COURSE_ID = COURSE_LIST[0].id
export const AVATAR_COLORS = [
  '#3df5ff', '#ff3df0', '#a24bff', '#7c3aff', '#ff4d8d', '#ffb43d', '#3dffa2', '#4d8dff',
] as const

/** True when `id` is a known course (see COURSE_LIST). */
export function isValidCourseId(id: string): boolean {
  return COURSE_LIST.some((c) => c.id === id)
}
/** A stored/absent preferred course id resolved to a real one — falls back to Algebra 1. */
export function resolveCourseId(id: string | undefined): string {
  return id !== undefined && isValidCourseId(id) ? id : DEFAULT_COURSE_ID
}
/** True when `color` is one of the AA-safe avatar accents. */
export function isValidAvatarColor(color: string): boolean {
  return (AVATAR_COLORS as readonly string[]).includes(color)
}
/**
 * Correct/answered as a 0–1 ratio, or null when nothing has been answered yet.
 * Display-only — the ratio is never persisted (the two counters are).
 */
export function accuracy(answered: number, correct: number): number | null {
  if (answered <= 0) return null
  return correct / answered
}

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
  const merged: PlayerState = {
    coins: Math.max(local.coins, cloud.coins),
    xp: Math.max(local.xp, cloud.xp),
    streak: Math.max(local.streak, cloud.streak),
    lastPlayed: local.lastPlayed > cloud.lastPlayed ? local.lastPlayed : cloud.lastPlayed,
    bests,
    gamesPlayed: Math.max(local.gamesPlayed, cloud.gamesPlayed),
    questionsAnswered: Math.max(local.questionsAnswered, cloud.questionsAnswered),
    questionsCorrect: Math.max(local.questionsCorrect, cloud.questionsCorrect),
  }
  // The handle is server-authoritative (the usernames reservation), so prefer
  // the cloud copy; fall back to local so a just-claimed handle isn't dropped.
  const username = cloud.username ?? local.username
  if (username !== undefined) merged.username = username
  // Non-numeric prefs are cloud-preferred too (a device switch adopts the last
  // saved choice), falling back to a just-set local value.
  const preferredCourseId = cloud.preferredCourseId ?? local.preferredCourseId
  if (preferredCourseId !== undefined) merged.preferredCourseId = preferredCourseId
  const avatarColor = cloud.avatarColor ?? local.avatarColor
  if (avatarColor !== undefined) merged.avatarColor = avatarColor
  return merged
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
  const state: PlayerState = {
    coins: num(d.coins),
    xp: num(d.xp),
    streak: num(d.streak),
    lastPlayed: typeof d.lastPlayed === 'string' && DATE_RE.test(d.lastPlayed) ? d.lastPlayed : '',
    bests,
    gamesPlayed: num(d.gamesPlayed),
    questionsAnswered: num(d.questionsAnswered),
    questionsCorrect: num(d.questionsCorrect),
  }
  if (typeof d.username === 'string' && d.username.length > 0) state.username = d.username
  // Prefs from an untrusted doc are validated against the known sets — an
  // unknown course id or off-palette color is dropped (consumers fall back).
  if (typeof d.preferredCourseId === 'string' && isValidCourseId(d.preferredCourseId)) {
    state.preferredCourseId = d.preferredCourseId
  }
  if (typeof d.avatarColor === 'string' && isValidAvatarColor(d.avatarColor)) {
    state.avatarColor = d.avatarColor
  }
  return state
}

// Firestore is loaded lazily (see lib/firebase.ts) — this helper pairs the SDK
// module with the initialized db so callers get both in one await.
async function firestoreSdk() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}
type FsSdk = Awaited<ReturnType<typeof firestoreSdk>>['sdk']

// The players/{uid} doc mirrors PlayerState plus { email, updatedAt }. Built
// field-by-field (not spread) so an absent `username` is never written as
// `undefined` — Firestore rejects undefined values.
function cloudPayload(sdk: FsSdk, user: User, state: PlayerState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    coins: state.coins, xp: state.xp, streak: state.streak,
    lastPlayed: state.lastPlayed, bests: state.bests,
    gamesPlayed: state.gamesPlayed,
    questionsAnswered: state.questionsAnswered,
    questionsCorrect: state.questionsCorrect,
    email: user.email, updatedAt: sdk.serverTimestamp(),
  }
  if (state.username) payload.username = state.username
  if (state.preferredCourseId) payload.preferredCourseId = state.preferredCourseId
  if (state.avatarColor) payload.avatarColor = state.avatarColor
  return payload
}

async function writeCloud(user: User, state: PlayerState): Promise<void> {
  const { sdk, db } = await firestoreSdk()
  await sdk.setDoc(sdk.doc(db, 'players', user.uid), cloudPayload(sdk, user, state), { merge: true })
}

interface Ctx {
  player: PlayerState
  finishGame: (gameKey: string, score: number) => { xp: number; coins: number; best: boolean }
  recordAnswer: (correct: boolean) => void
  setUsername: (username: string) => void
  updatePreferences: (patch: { preferredCourseId?: string; avatarColor?: string }) => void
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
      await sdk.setDoc(ref, cloudPayload(sdk, user, next), { merge: true })
    }
    sync().catch((err: unknown) => console.error('[eclipse-arcade] cloud sync failed:', err))
    return () => { stale = true }
  }, [user])

  // The single commit path for local + write-through: adopt `next`, persist to
  // localStorage, and (signed in) mirror to Firestore — fire-and-forget but
  // never silent. A denied write (e.g. old rules rejecting new fields) is
  // logged; local state is already updated, so the app degrades gracefully.
  const commit = useCallback((next: PlayerState) => {
    playerRef.current = next
    setPlayer(next)
    save(next)
    const u = userRef.current
    if (u) {
      writeCloud(u, next).catch((err: unknown) =>
        console.error('[eclipse-arcade] cloud save failed:', err))
    }
  }, [])

  const finishGame = useCallback((gameKey: string, score: number) => {
    const { xp, coins } = rewardsFor(score)
    const prev = playerRef.current
    const t = today()
    let streak = prev.streak
    if (prev.lastPlayed !== t) {
      streak = prev.lastPlayed === yesterday() ? prev.streak + 1 : 1
    }
    const prevBest = prev.bests[gameKey] ?? 0
    // Spread `prev` so prefs (username, preferredCourseId, avatarColor) and the
    // answer counters survive a game finish untouched.
    const next: PlayerState = {
      ...prev,
      coins: prev.coins + coins,
      xp: prev.xp + xp,
      streak,
      lastPlayed: t,
      bests: { ...prev.bests, [gameKey]: Math.max(prevBest, score) },
      gamesPlayed: prev.gamesPlayed + 1,
    }
    commit(next)
    return { xp, coins, best: score > prevBest }
  }, [commit])

  // Question games (Battleship solo + PvP) call this at the answer boundary —
  // NOT the flat pin/slider loop, which has no right/wrong. Cumulative counters
  // only; accuracy is derived for display.
  const recordAnswer = useCallback((correct: boolean) => {
    const prev = playerRef.current
    const next: PlayerState = {
      ...prev,
      questionsAnswered: prev.questionsAnswered + 1,
      questionsCorrect: prev.questionsCorrect + (correct ? 1 : 0),
    }
    commit(next)
  }, [commit])

  // Profile prefs (math level, avatar color) — a normal write-through; only the
  // keys present in `patch` change.
  const updatePreferences = useCallback((patch: { preferredCourseId?: string; avatarColor?: string }) => {
    const next: PlayerState = { ...playerRef.current }
    if (patch.preferredCourseId !== undefined) next.preferredCourseId = patch.preferredCourseId
    if (patch.avatarColor !== undefined) next.avatarColor = patch.avatarColor
    commit(next)
  }, [commit])

  // The username WRITE is owned by claimUsername (it must be transactional with
  // the usernames reservation collection, which finishGame can't do atomically).
  // This only mirrors the confirmed handle into local state/localStorage so the
  // UI updates immediately — no extra cloud write.
  const setUsername = useCallback((username: string) => {
    const next = { ...playerRef.current, username }
    playerRef.current = next
    setPlayer(next)
    save(next)
  }, [])

  return (
    <PlayerCtx.Provider value={{ player, finishGame, recordAnswer, setUsername, updatePreferences }}>
      {children}
    </PlayerCtx.Provider>
  )
}

export function usePlayer(): Ctx {
  const c = useContext(PlayerCtx)
  if (!c) throw new Error('usePlayer must be used within PlayerProvider')
  return c
}
