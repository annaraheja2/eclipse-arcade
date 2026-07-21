import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSES, type Unit, type Subunit, type Question } from '../data/subjects'
import {
  shipCells, placementOk, randomFleet, allSunk, isSunk, keyOf, aiPick,
  type Ship,
} from '../lib/battleship'
import BattleGrid, { type Shots } from '../components/BattleGrid'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer } from '../lib/player'
import { ArrowLeft } from '../icons'
import { sfxFire, sfxHit, sfxMiss, sfxSink, sfxWin, setMuted, isMuted } from '../lib/sound'

const CY = '#3df5ff'
const course = COURSES[0] // Algebra 1 (from profile later)

function impactSound(result: 'miss' | 'hit' | 'sunk') {
  sfxFire()
  setTimeout(() => (result === 'miss' ? sfxMiss() : result === 'sunk' ? sfxSink() : sfxHit()), 320)
}

type Phase = 'unit' | 'subunit' | 'place' | 'battle' | 'over'
interface Battle { enemy: Ship[]; placed: Ship[]; pShots: Shots; eShots: Shots; phase: 'q' | 'aim'; q: Question; msg: string; busy: boolean; lastP?: string; lastE?: string }

function applyFire(ships: Ship[], r: number, c: number): { ships: Ship[]; result: 'miss' | 'hit' | 'sunk' } {
  let result: 'miss' | 'hit' | 'sunk' = 'miss'
  const next = ships.map((sh) => {
    if (sh.cells.some((x) => x.r === r && x.c === c)) { const hits = sh.hits + 1; result = hits >= sh.size ? 'sunk' : 'hit'; return { ...sh, hits } }
    return sh
  })
  return { ships: next, result }
}
const randomQ = (s: Subunit): Question => s.questions[Math.floor(Math.random() * s.questions.length)]
const remaining = (ships: Ship[]) => ships.filter((s) => !isSunk(s)).length

export default function Battleship() {
  const navigate = useNavigate()
  const { finishGame } = usePlayer()
  const [ph, setPh] = useState<Phase>('unit')
  const [unit, setUnit] = useState<Unit | null>(null)
  const [sub, setSub] = useState<Subunit | null>(null)

  // placement — all ships start placed; player rearranges.
  const [placed, setPlaced] = useState<Ship[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [battle, setBattle] = useState<Battle | null>(null)
  const [winner, setWinner] = useState<'you' | 'ai' | null>(null)
  const [rewarded, setRewarded] = useState(false)
  const [muted, setMutedState] = useState(isMuted())

  const battleRef = useRef<Battle | null>(battle)
  useEffect(() => { battleRef.current = battle }, [battle])

  // Game-over detection.
  useEffect(() => {
    if (ph !== 'battle' || !battle) return
    if (allSunk(battle.enemy)) { setWinner('you'); setPh('over') }
    else if (allSunk(battle.placed)) { setWinner('ai'); setPh('over') }
  }, [battle, ph])

  useEffect(() => {
    if (ph === 'over' && !rewarded) {
      finishGame('battleship', winner === 'you' ? 3000 : 500)
      if (winner === 'you') sfxWin()
      setRewarded(true)
    }
  }, [ph, rewarded, winner, finishGame])

  // ----- placement helpers -----
  function placementClick(r: number, c: number) {
    const hit = placed.find((sh) => sh.cells.some((x) => x.r === r && x.c === c))
    if (hit) { setSelectedId(hit.id); return }        // tap a ship → select it
    const sh = placed.find((s) => s.id === selectedId)
    if (!sh) return                                    // tap water with nothing selected
    const horiz = sh.cells.every((x) => x.r === sh.cells[0].r)
    const cells = shipCells(r, c, sh.size, horiz)      // move selected ship's anchor here
    const others = placed.filter((s) => s.id !== sh.id)
    if (placementOk(cells, others)) setPlaced(placed.map((s) => (s.id === sh.id ? { ...s, cells } : s)))
  }
  function rotateSelected() {
    const sh = placed.find((s) => s.id === selectedId)
    if (!sh) return
    const minR = Math.min(...sh.cells.map((x) => x.r)), minC = Math.min(...sh.cells.map((x) => x.c))
    const horiz = sh.cells.every((x) => x.r === sh.cells[0].r)
    const cells = shipCells(minR, minC, sh.size, !horiz)
    const others = placed.filter((s) => s.id !== sh.id)
    if (placementOk(cells, others)) setPlaced(placed.map((s) => (s.id === sh.id ? { ...s, cells } : s)))
  }
  function shuffle() { setPlaced(randomFleet()); setSelectedId(null) }
  function startBattle() {
    if (!sub) return
    setBattle({ enemy: randomFleet(), placed, pShots: {}, eShots: {}, phase: 'q', q: randomQ(sub), msg: '', busy: false })
    setPh('battle')
  }

  // ----- battle helpers -----
  function onAnswer(correct: boolean) {
    setBattle((b) => b && { ...b, phase: correct ? 'aim' : b.phase, busy: !correct, msg: correct ? 'Correct! Take your shot.' : 'Wrong! Enemy returns fire…' })
    if (!correct) aiTurn()
  }
  function fireAtEnemy(r: number, c: number) {
    const b = battleRef.current
    if (!b || b.phase !== 'aim' || b.busy || b.pShots[keyOf(r, c)]) return
    const { ships, result } = applyFire(b.enemy, r, c)
    const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
    impactSound(result)
    setBattle((cur) => cur && ({
      ...cur, enemy: ships, pShots: { ...cur.pShots, [keyOf(r, c)]: mark }, lastP: keyOf(r, c), busy: true,
      msg: result === 'sunk' ? 'Enemy ship SUNK!' : result === 'hit' ? 'Direct hit!' : 'Splash — miss.',
    }))
    aiTurn()
  }
  function aiTurn() {
    setTimeout(() => {
      const b = battleRef.current
      if (!b || allSunk(b.enemy)) { setBattle((c) => c && ({ ...c, busy: false })); return } // player already won
      const cell = aiPick(new Set(Object.keys(b.eShots)))
      const { ships, result } = applyFire(b.placed, cell.r, cell.c)
      const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
      impactSound(result)
      const over = allSunk(ships)
      setBattle((cur) => cur && ({
        ...cur, placed: ships, eShots: { ...cur.eShots, [keyOf(cell.r, cell.c)]: mark }, lastE: keyOf(cell.r, cell.c),
        phase: over || !sub ? cur.phase : 'q', q: over || !sub ? cur.q : randomQ(sub), msg: '', busy: false,
      }))
    }, 900)
  }

  const back = () => navigate('/')

  // ================= RENDER =================
  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button onClick={ph === 'unit' ? back : () => resetTo(ph, setPh, setUnit, setSub, setPlaced)} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="font-pixel text-[12px]" style={{ color: CY }}>BATTLESHIP</div>
          <button onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white text-base">{muted ? '🔇' : '🔊'}</button>
        </div>

        {ph === 'unit' && (
          <Section title="CHOOSE A UNIT">
            <div className="grid gap-3 sm:grid-cols-2">
              {course.units.map((u) => (
                <button key={u.id} onClick={() => { setUnit(u); setPh('subunit') }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-neon-cyan/60 transition">
                  <div className="font-bold">{u.name}</div>
                  <div className="text-xs text-white/40 mt-1">{u.subunits.length} topics</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {ph === 'subunit' && unit && (
          <Section title={`${unit.name.toUpperCase()} — PICK A TOPIC`}>
            <div className="grid gap-3 sm:grid-cols-2">
              {unit.subunits.map((s) => (
                <button key={s.id} onClick={() => { setSub(s); setPlaced(randomFleet()); setSelectedId(null); setPh('place') }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-neon-cyan/60 transition">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{s.name}</span>
                    <DiffBadge d={s.difficulty} />
                  </div>
                  <div className="text-xs text-white/40 mt-1 uppercase tracking-wide">{s.type} · vs AI</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {ph === 'place' && (
          <Section title="ARRANGE YOUR FLEET">
            <p className="text-center text-sm text-white/50 mb-4">Tap a ship to select it · tap water to move it · ROTATE to turn it · ships can’t touch</p>
            <div className="flex justify-center mb-4">
              <BattleGrid ships={placed} shots={{}} showShips selected={selectedId ?? undefined} onCell={placementClick} />
            </div>
            <div className="flex justify-center gap-2.5 flex-wrap">
              <Btn onClick={rotateSelected}>ROTATE</Btn>
              <Btn onClick={shuffle}>SHUFFLE</Btn>
              <button onClick={startBattle}
                className="font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620]" style={{ background: CY, boxShadow: `0 0 16px ${CY}88` }}>
                START BATTLE
              </button>
            </div>
          </Section>
        )}

        {ph === 'battle' && battle && (
          <div>
            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-white/50">Enemy ships left: <b className="text-neon-pink">{remaining(battle.enemy)}</b></span>
              <span className="text-white/50">Your ships left: <b className="text-neon-cyan">{remaining(battle.placed)}</b></span>
            </div>

            <div className="text-center mb-2">
              <div className="font-pixel text-[10px] text-white/60">ENEMY WATERS</div>
            </div>
            <div className="flex justify-center mb-4">
              <BattleGrid ships={battle.enemy} shots={battle.pShots} showShips={false} lastShot={battle.lastP}
                disabled={battle.phase !== 'aim' || battle.busy} onCell={fireAtEnemy} />
            </div>

            {battle.msg && <div className="text-center font-pixel text-[11px] mb-3" style={{ color: CY }}>{battle.msg}</div>}

            {battle.phase === 'q' && !battle.busy
              ? <QuestionPanel q={battle.q} color={CY} onSubmit={onAnswer} />
              : battle.phase === 'aim'
                ? <p className="text-center text-white/60 text-sm mb-4">🎯 Tap the enemy waters to fire!</p>
                : <p className="text-center text-white/40 text-sm mb-4">Enemy is firing…</p>}

            <div className="mt-5">
              <div className="text-center font-pixel text-[9px] text-white/40 mb-1">YOUR FLEET</div>
              <div className="flex justify-center">
                <BattleGrid ships={battle.placed} shots={battle.eShots} showShips disabled small lastShot={battle.lastE} />
              </div>
            </div>
          </div>
        )}

        {ph === 'over' && (
          <div className="text-center py-12">
            <div className="font-pixel text-2xl mb-4" style={{ color: winner === 'you' ? '#3dffa2' : '#ff4d8d' }}>
              {winner === 'you' ? 'VICTORY!' : 'DEFEATED'}
            </div>
            <p className="text-white/50 mb-6">{winner === 'you' ? 'You sank the enemy fleet.' : 'Your fleet was sunk.'}</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => { setPlaced([]); setBattle(null); setWinner(null); setRewarded(false); setPh('place') }}
                className="font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={{ background: CY, boxShadow: `0 0 18px ${CY}88` }}>PLAY AGAIN</button>
              <button onClick={back} className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">ARCADE</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function resetTo(ph: Phase, setPh: (p: Phase) => void, setUnit: (u: Unit | null) => void, setSub: (s: Subunit | null) => void, setPlaced: (s: Ship[]) => void) {
  if (ph === 'subunit') { setUnit(null); setPh('unit') }
  else if (ph === 'place') { setSub(null); setPlaced([]); setPh('subunit') }
  else setPh('unit')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h2 className="font-pixel text-[11px] tracking-wider text-neon-cyan neon-text mb-5 text-center">{title}</h2>{children}</div>
}
function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10">{children}</button>
}
function DiffBadge({ d }: { d: 'easy' | 'medium' | 'hard' }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[9px] font-pixel px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
