import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Moon, Search, Coin, Flame, Bolt, Users, Bell, User,
  Target, Slide, Grid, Link2, Chart, Star, Ship,
} from '../icons'
import { GAMES, type GameDef } from '../lib/games'
import { usePlayer, levelFromXp, isStreakAtRisk, todayStr } from '../lib/player'

const ICON: Record<string, ReactNode> = {
  battleship: <Ship />, daily: <Star />, pinpoint: <Target />, slider: <Slide />,
  gridfill: <Grid />, matchup: <Link2 />, fitline: <Chart />,
}

export default function Lobby() {
  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative">
        <Hud />
        <main className="max-w-6xl mx-auto px-6 pb-24">
          <Hero />
          <section>
            <h2 className="font-pixel text-[11px] tracking-wider text-neon-cyan neon-text mb-6">SELECT A GAME</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {GAMES.map((g) => <Cabinet key={g.key} g={g} />)}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function Hud() {
  const { player } = usePlayer()
  const { level, pct } = levelFromXp(player.xp)
  return (
    <header className="sticky top-0 z-20 backdrop-blur-xl bg-[#0a0620]/70 border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-neon-purple to-neon-violet text-white shadow-[0_0_18px_rgba(162,75,255,0.7)]">
            <Moon width={22} height={22} />
          </span>
          <span className="hidden sm:block font-pixel text-[11px] tracking-wide text-white/90">ECLIPSE</span>
        </div>
        <div className="flex-1 max-w-sm">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-sm">
            <Search width={16} height={16} /> <span>Search games</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3.5 shrink-0">
          <Chip color="#ffb43d" icon={<Coin width={17} height={17} />} value={player.coins.toLocaleString()} />
          <Chip color="#ff6b3d" icon={<Flame width={17} height={17} />} value={`${player.streak}`} />
          <div className="flex items-center gap-2.5 pl-3 pr-4 py-1.5 rounded-full bg-white/5 border border-white/10">
            <span className="text-neon-cyan"><Bolt width={16} height={16} /></span>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-white/80 leading-none">LVL {level}</span>
              <span className="mt-1.5 block w-20 h-1 rounded-full bg-white/15 overflow-hidden">
                <span className="block h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-magenta" style={{ width: `${pct}%` }} />
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <IconBtn><Users width={18} height={18} /></IconBtn>
          <IconBtn dot><Bell width={18} height={18} /></IconBtn>
          <button className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-blue text-[#06121a] shadow-[0_0_16px_rgba(61,245,255,0.6)]">
            <User width={18} height={18} />
          </button>
        </div>
      </div>
    </header>
  )
}

function Chip({ color, icon, value }: { color: string; icon: ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-sm font-semibold" style={{ color }}>
      {icon}<span className="tabular-nums">{value}</span>
    </div>
  )
}

function IconBtn({ children, dot }: { children: ReactNode; dot?: boolean }) {
  return (
    <button className="relative grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition">
      {children}
      {dot && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-neon-pink shadow-[0_0_8px_#ff4d8d]" />}
    </button>
  )
}

function Hero() {
  return (
    <section className="text-center py-16 sm:py-24">
      <div className="font-pixel leading-[1.35] select-none">
        <span className="block text-3xl sm:text-5xl text-neon-cyan neon-text">ECLIPSE</span>
        <span className="block text-3xl sm:text-5xl mt-3 text-neon-magenta neon-text">ARCADE</span>
      </div>
      <p className="mt-7 text-white/60 text-sm sm:text-base max-w-md mx-auto">
        Play math, score high, level up. Pick a cabinet and drop in.
      </p>
      <StreakBanner />
    </section>
  )
}

// Streak surfaced at every breakpoint (the HUD chip is desktop-only) with a
// loss-aversion nudge. Solid-color text on #0a0620 for AA contrast — not glow.
function StreakBanner() {
  const { player } = usePlayer()
  const today = todayStr()
  const playedToday = player.lastPlayed === today
  const atRisk = isStreakAtRisk(player.lastPlayed, today)

  let text: string
  if (player.streak === 0) text = 'Start a streak today'
  else if (playedToday) text = `${player.streak}-day streak — see you tomorrow`
  else if (atRisk) text = `Play today to keep your ${player.streak}-day streak`
  else text = 'Start a streak today' // streak recorded but a day was skipped — it resets on next play

  return (
    <div className="mt-8 flex justify-center">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
        <span className="text-neon-amber"><Flame width={16} height={16} /></span>
        <span className="text-sm font-semibold text-white/90">{text}</span>
      </div>
    </div>
  )
}

function Cabinet({ g }: { g: GameDef }) {
  const navigate = useNavigate()
  const { player } = usePlayer()
  const soon = g.type === 'soon'
  const best = player.bests[g.key]
  const dailyDone = g.key === 'daily' && localStorage.getItem(`eclipse-arcade:daily:${todayStr()}`) === '1'
  const glow = soon ? 'none' : `0 0 0 1px ${g.color}55, 0 14px 46px -14px ${g.color}80`
  return (
    <button
      disabled={soon}
      onClick={() => { if (soon) return; navigate(g.type === 'battleship' ? '/battleship' : `/play/${g.key}`) }}
      className={`group relative overflow-hidden text-left rounded-2xl border transition-all duration-300 ${soon ? 'opacity-60 cursor-default' : 'hover:-translate-y-1.5'}`}
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        borderColor: soon ? 'rgba(255,255,255,0.10)' : `${g.color}55`,
        boxShadow: glow,
      }}
    >
      <div className="relative h-44 grid place-items-center" style={{ background: `radial-gradient(120% 120% at 50% 0%, ${g.color}33, transparent 70%)` }}>
        <span className="grid place-items-center w-20 h-20 rounded-2xl" style={{ color: g.color, background: `${g.color}1f`, boxShadow: soon ? 'none' : `0 0 30px ${g.color}77` }}>
          <span className="[&>svg]:w-9 [&>svg]:h-9">{ICON[g.key]}</span>
        </span>
        {g.key === 'daily' && !soon && (
          dailyDone
            ? <span className="absolute top-3 left-3 text-[9px] font-pixel px-2 py-1 rounded bg-neon-green text-[#04180f]">PLAYED</span>
            : <span className="absolute top-3 left-3 text-[9px] font-pixel px-2 py-1 rounded bg-neon-amber text-[#2a1a00]">DAILY</span>
        )}
        {soon && <span className="absolute top-3 right-3 text-[9px] font-pixel px-2 py-1 rounded bg-white/10 text-white/70">SOON</span>}
      </div>
      <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
        <div className="min-w-0">
          <div className="font-bold text-white truncate">{g.name}</div>
          {!soon && <div className="text-xs text-white/45 mt-0.5">Best <span className="font-bold tabular-nums" style={{ color: g.color }}>{(best ?? 0).toLocaleString()}</span></div>}
        </div>
        {!soon && <span className="text-[10px] font-pixel px-4 py-2.5 rounded-lg text-[#0a0620] transition group-hover:brightness-110 shrink-0" style={{ background: g.color, boxShadow: `0 0 16px ${g.color}88` }}>PLAY</span>}
      </div>
    </button>
  )
}
