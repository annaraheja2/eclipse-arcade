import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

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

interface Ctx {
  player: PlayerState
  finishGame: (gameKey: string, score: number) => { xp: number; coins: number; best: boolean }
}
const PlayerCtx = createContext<Ctx | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<PlayerState>(() => load())

  const finishGame = useCallback((gameKey: string, score: number) => {
    const { xp, coins } = rewardsFor(score)
    let result = { xp, coins, best: false }
    setPlayer((prev) => {
      const t = today()
      let streak = prev.streak
      if (prev.lastPlayed !== t) {
        streak = prev.lastPlayed === yesterday() ? prev.streak + 1 : 1
      }
      const prevBest = prev.bests[gameKey] ?? 0
      const best = score > prevBest
      result = { xp, coins, best }
      const next: PlayerState = {
        coins: prev.coins + coins,
        xp: prev.xp + xp,
        streak,
        lastPlayed: t,
        bests: { ...prev.bests, [gameKey]: Math.max(prevBest, score) },
      }
      save(next)
      return next
    })
    return result
  }, [])

  return <PlayerCtx.Provider value={{ player, finishGame }}>{children}</PlayerCtx.Provider>
}

export function usePlayer(): Ctx {
  const c = useContext(PlayerCtx)
  if (!c) throw new Error('usePlayer must be used within PlayerProvider')
  return c
}
