import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Search, Coin, Flame, Bolt, Users, Bell, User } from '../icons'
import { GAMES, type GameDef } from '../lib/games'
import GameThumbnail from '../components/GameThumbnail'
import AccountControl from '../components/AccountControl'
import { usePlayer, levelFromXp, isStreakAtRisk, todayStr } from '../lib/player'
import { isFirebaseConfigured } from '../lib/firebase'

// React.CSSProperties has no index signature for custom properties; these widen it
// only for the accent vars consumed by `.arcade-btn` / `.cab-live` / `.wordmark`
// in index.css.
type ArcadeBtnVars = CSSProperties & { '--btn': string; '--edge': string; '--glow': string }
type CabVars = CSSProperties & { '--cab'?: string }
type WordmarkVars = CSSProperties & { '--wm': string; '--wm-glow': string }

function arcadeBtnStyle(color: string): ArcadeBtnVars {
  return {
    '--btn': color,
    '--edge': `color-mix(in srgb, ${color} 50%, #000)`,
    '--glow': `${color}88`,
  }
}

function wordmarkStyle(color: string, glow: string): WordmarkVars {
  return { '--wm': color, '--wm-glow': glow }
}

export default function Lobby() {
  return (
    <div className="min-h-screen">
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-floor" />
      <div aria-hidden className="pointer-events-none fixed inset-0 spotlights" />
      <div className="relative">
        <Hud />
        <main className="max-w-6xl mx-auto px-6 pb-24">
          <Hero />
          <section>
            <SectionHeader>SELECT A GAME</SectionHeader>
            <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
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
          <span className="hidden sm:block font-display text-lg tracking-wide text-white/95">ECLIPSE</span>
        </div>
        <div className="flex-1 max-w-sm">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-sm">
            <Search width={16} height={16} /> <span>Search games</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3.5 shrink-0">
          <Chip color="#ffb43d" icon={<Coin width={17} height={17} />} label="CREDITS" value={player.coins.toLocaleString()} />
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
          {isFirebaseConfigured ? (
            <AccountControl />
          ) : (
            <button className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-blue text-[#06121a] shadow-[0_0_16px_rgba(61,245,255,0.6)]">
              <User width={18} height={18} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function Chip({ color, icon, label, value }: { color: string; icon: ReactNode; label?: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-sm font-semibold" style={{ color }}>
      {icon}
      {label && <span className="font-pixel text-[7px] tracking-wider pt-0.5">{label}</span>}
      <span className="tabular-nums">{value}</span>
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
  const { player } = usePlayer()
  return (
    <section className="text-center py-12 sm:py-16">
      <div className="marquee-sign mx-auto max-w-2xl px-5 sm:px-8 py-4 select-none">
        <BulbRow />
        <div className="leading-none py-6 sm:py-8">
          <span className="wordmark block text-5xl sm:text-7xl" style={wordmarkStyle('#3df5ff', 'rgba(61,245,255,0.5)')}>
            ECLIPSE
          </span>
          <span className="wordmark block text-5xl sm:text-7xl mt-2 sm:mt-3" style={wordmarkStyle('#ff3df0', 'rgba(255,61,240,0.5)')}>
            ARCADE
          </span>
        </div>
        <BulbRow />
      </div>
      <p className="mt-7 text-white/60 text-sm sm:text-base max-w-md mx-auto">
        Play math, score high, level up. Pick a cabinet and drop in.
      </p>
      <div className="mt-6 font-pixel text-[10px] flex items-center justify-center gap-x-7 gap-y-3 flex-wrap">
        <span className="blink-attract text-neon-amber">INSERT COIN</span>
        <span className="text-white/80">
          CREDITS <span className="text-neon-amber tabular-nums">{player.coins.toLocaleString()}</span>
        </span>
      </div>
      <StreakBanner />
    </section>
  )
}

// Section headers get theater-marquee framing: gradient rules + diamond studs.
function SectionHeader({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-4 mb-8">
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-transparent to-neon-cyan/70" />
      <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-neon-cyan shadow-[0_0_8px_#3df5ff]" />
      <h2 className="font-pixel text-[12px] sm:text-[13px] tracking-[0.25em] text-neon-cyan neon-text">
        {children}
      </h2>
      <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-neon-cyan shadow-[0_0_8px_#3df5ff]" />
      <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-transparent to-neon-cyan/70" />
    </div>
  )
}

// Marquee bulbs: staggered delays make the pulse travel along the row like a chase.
function BulbRow() {
  return (
    <div aria-hidden className="flex justify-between px-1">
      {Array.from({ length: 13 }, (_, i) => (
        <span key={i} className="bulb" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
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

// Bevel highlights/shades shared by every cabinet body; the accent ring + glow is
// composed per game (box-shadow is a single property, so it's built as one string).
const CAB_BEVEL = [
  'inset 0 2px 0 rgba(255,255,255,0.10)',
  'inset 0 -4px 0 rgba(0,0,0,0.55)',
  'inset 2px 0 0 rgba(255,255,255,0.04)',
  'inset -2px 0 0 rgba(0,0,0,0.35)',
].join(', ')

function Cabinet({ g }: { g: GameDef }) {
  const navigate = useNavigate()
  const { player } = usePlayer()
  const soon = g.type === 'soon'
  const best = player.bests[g.key]
  const dailyDone = g.key === 'daily' && localStorage.getItem(`eclipse-arcade:daily:${todayStr()}`) === '1'
  const shadow = soon
    ? `${CAB_BEVEL}, 0 12px 24px -12px rgba(0,0,0,0.8)`
    : `${CAB_BEVEL}, 0 0 0 1px ${g.color}40, 0 16px 36px -14px ${g.color}70, 0 14px 28px -12px rgba(0,0,0,0.8)`
  const cabStyle: CabVars = {
    background: 'linear-gradient(180deg, #241543, #120a2c 60%, #0c0722)',
    boxShadow: shadow,
  }
  if (!soon) cabStyle['--cab'] = g.color
  return (
    <button
      disabled={soon}
      onClick={() => { if (soon) return; navigate(g.type === 'battleship' ? '/battleship' : `/play/${g.key}`) }}
      className={`cab group relative text-left rounded-[14px] border border-white/10 transition-transform duration-200 ${soon ? 'opacity-60 cursor-default' : 'cab-live hover:-translate-y-1 active:translate-y-0.5'}`}
      style={cabStyle}
    >
      <div className="cab-marquee rounded-t-[13px]">
        <span
          className="block text-center font-pixel text-[9px] tracking-wider truncate"
          style={{
            color: soon ? 'rgba(255,255,255,0.75)' : `color-mix(in srgb, ${g.color} 70%, #fff)`,
            textShadow: soon ? 'none' : `0 0 10px ${g.color}`,
          }}
        >
          {g.name.toUpperCase()}
        </span>
      </div>
      <div
        className="cab-screen relative h-40"
        style={{ background: `radial-gradient(120% 100% at 50% 0%, ${g.color}2e, transparent 70%), #050213` }}
      >
        <GameThumbnail g={g} />
        <span aria-hidden className="cab-shine" />
        {g.key === 'daily' && !soon && (
          dailyDone
            ? <span className="absolute top-3 left-3 text-[9px] font-pixel px-2 py-1 rounded bg-neon-green text-[#04180f]">PLAYED</span>
            : <span className="absolute top-3 left-3 text-[9px] font-pixel px-2 py-1 rounded bg-neon-amber text-[#2a1a00]">DAILY</span>
        )}
        {soon && <span className="absolute top-3 right-3 text-[9px] font-pixel px-2 py-1 rounded bg-white/10 text-white/70">SOON</span>}
      </div>
      <div className="cab-panel flex items-center justify-between px-4 py-3.5">
        <div className="min-w-0">
          <span aria-hidden className="flex items-center gap-2">
            <span className="joy" />
            <span className="mini-btn" style={{ background: soon ? '#4a4460' : g.color }} />
            <span className="mini-btn bg-white/25" />
          </span>
          {!soon && (
            <div className="text-xs text-white/60 mt-2">
              Best <span className="font-bold tabular-nums" style={{ color: `color-mix(in srgb, ${g.color} 70%, #fff)` }}>{(best ?? 0).toLocaleString()}</span>
            </div>
          )}
        </div>
        {soon
          ? <span className="text-[9px] font-pixel text-white/60 shrink-0">COMING SOON</span>
          : <span className="arcade-btn text-[10px] font-pixel px-4 py-2.5 rounded-lg text-[#0a0620] shrink-0" style={arcadeBtnStyle(g.color)}>PLAY</span>}
      </div>
    </button>
  )
}
