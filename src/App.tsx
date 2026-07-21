import type { ReactNode } from 'react'
import {
  Moon, Search, Coin, Flame, Bolt, Users, Bell, User,
  Target, Slide, Grid, Link2, Chart, Star,
} from './icons'

// ---- Mock player + games (prototype data) ----
const PLAYER = { level: 7, xp: 62, coins: 1240, streak: 5, name: 'You' }

interface Game {
  key: string; name: string; sub: string; color: string; icon: ReactNode
  best?: number; soon?: boolean; featured?: boolean
}
const GAMES: Game[] = [
  { key: 'daily', name: 'Daily Challenge', sub: 'New every day · earn 2× coins', color: '#ffb43d', icon: <Star />, featured: true, best: 3820 },
  { key: 'pinpoint', name: 'PinPoint', sub: 'Drop a pin on the grid', color: '#3df5ff', icon: <Target />, best: 4820 },
  { key: 'slider', name: 'Slider', sub: 'Land on the number line', color: '#ffb43d', icon: <Slide />, best: 3910 },
  { key: 'gridfill', name: 'Grid-Fill', sub: 'Matrices & vectors', color: '#3dffa2', icon: <Grid />, soon: true },
  { key: 'matchup', name: 'Match-Up', sub: 'Pair the expressions', color: '#ff4d8d', icon: <Link2 />, soon: true },
  { key: 'fitline', name: 'Fit-the-Line', sub: 'Best-fit the scatter', color: '#a24bff', icon: <Chart />, soon: true },
]

export default function App() {
  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative">
        <Hud />
        <main className="max-w-6xl mx-auto px-5 pb-20">
          <Hero />
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-pixel text-[11px] tracking-wider text-neon-cyan neon-text">SELECT A GAME</h2>
              <span className="text-xs text-white/40">6 cabinets</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {GAMES.map((g) => <Cabinet key={g.key} g={g} />)}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function Hud() {
  return (
    <header className="sticky top-0 z-20 backdrop-blur-xl bg-[#0a0620]/70 border-b border-white/10">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center gap-3">
        {/* logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-neon-purple to-neon-violet text-white shadow-[0_0_18px_rgba(162,75,255,0.7)]">
            <Moon width={20} height={20} />
          </span>
          <span className="hidden sm:block font-pixel text-[11px] tracking-wide text-white/90">ECLIPSE</span>
        </div>
        {/* search */}
        <div className="flex-1 max-w-xs mx-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-sm">
            <Search width={16} height={16} /> <span>Search games</span>
          </div>
        </div>
        {/* stats */}
        <div className="flex items-center gap-2">
          <Chip color="#ffb43d" icon={<Coin width={16} height={16} />} value={PLAYER.coins.toLocaleString()} />
          <Chip color="#ff6b3d" icon={<Flame width={16} height={16} />} value={`${PLAYER.streak}`} />
          <LevelChip />
        </div>
        {/* icon buttons */}
        <div className="flex items-center gap-1.5 ml-1">
          <IconBtn><Users width={18} height={18} /></IconBtn>
          <IconBtn dot><Bell width={18} height={18} /></IconBtn>
          <button className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-blue text-[#06121a] shadow-[0_0_16px_rgba(61,245,255,0.6)]">
            <User width={18} height={18} />
          </button>
        </div>
      </div>
    </header>
  )
}

function Chip({ color, icon, value }: { color: string; icon: ReactNode; value: string }) {
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-semibold"
      style={{ color }}>
      {icon}<span className="tabular-nums">{value}</span>
    </div>
  )
}

function LevelChip() {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
      <span className="text-neon-cyan"><Bolt width={15} height={15} /></span>
      <div className="flex flex-col">
        <span className="text-[10px] font-bold text-white/80 leading-none">LVL {PLAYER.level}</span>
        <span className="mt-1 block w-16 h-1 rounded-full bg-white/15 overflow-hidden">
          <span className="block h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-magenta" style={{ width: `${PLAYER.xp}%` }} />
        </span>
      </div>
    </div>
  )
}

function IconBtn({ children, dot }: { children: ReactNode; dot?: boolean }) {
  return (
    <button className="relative grid place-items-center w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition">
      {children}
      {dot && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-neon-pink shadow-[0_0_8px_#ff4d8d]" />}
    </button>
  )
}

function Hero() {
  return (
    <section className="text-center py-14 sm:py-20">
      <div className="font-pixel leading-[1.35] select-none">
        <span className="block text-3xl sm:text-5xl text-neon-cyan neon-text">ECLIPSE</span>
        <span className="block text-3xl sm:text-5xl mt-3 text-neon-magenta neon-text">ARCADE</span>
      </div>
      <p className="mt-6 text-white/60 text-sm sm:text-base max-w-md mx-auto">
        Play math, score high, level up. Pick a cabinet and drop in.
      </p>
    </section>
  )
}

function Cabinet({ g }: { g: Game }) {
  const glow = g.soon ? 'none' : `0 0 0 1px ${g.color}55, 0 10px 40px -12px ${g.color}80`
  return (
    <button
      disabled={g.soon}
      className={`group relative text-left rounded-2xl p-5 border transition-all duration-300 ${g.featured ? 'sm:col-span-2 lg:col-span-1' : ''} ${g.soon ? 'opacity-55 cursor-default' : 'hover:-translate-y-1'}`}
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        borderColor: g.soon ? 'rgba(255,255,255,0.10)' : `${g.color}55`,
        boxShadow: glow,
      }}
    >
      {g.featured && !g.soon && (
        <span className="absolute -top-2.5 left-4 text-[9px] font-pixel px-2 py-1 rounded bg-neon-amber text-[#2a1a00]">DAILY</span>
      )}
      {g.soon && (
        <span className="absolute top-3 right-3 text-[9px] font-pixel px-2 py-1 rounded bg-white/10 text-white/60">SOON</span>
      )}
      <div className="flex items-center gap-3.5">
        <span className="grid place-items-center w-12 h-12 rounded-xl shrink-0"
          style={{ color: g.color, background: `${g.color}1f`, boxShadow: g.soon ? 'none' : `0 0 18px ${g.color}66` }}>
          {g.icon}
        </span>
        <div className="min-w-0">
          <div className="font-bold text-white truncate">{g.name}</div>
          <div className="text-xs text-white/50 truncate">{g.sub}</div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {g.soon ? (
          <span className="text-xs text-white/40">In development</span>
        ) : (
          <span className="text-xs text-white/50">Best <span className="font-bold tabular-nums" style={{ color: g.color }}>{g.best?.toLocaleString()}</span></span>
        )}
        {!g.soon && (
          <span className="text-[10px] font-pixel px-3 py-2 rounded-lg text-[#0a0620] transition group-hover:brightness-110"
            style={{ background: g.color, boxShadow: `0 0 16px ${g.color}88` }}>PLAY</span>
        )}
      </div>
    </button>
  )
}
