import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSES, type Unit, type Subunit, type Question } from '../data/subjects'
import {
  FLEET, N, shipCells, placementOk, randomFleet, allSunk, isSunk, shipAt, keyOf, aiPick,
  type Ship, type Cell,
} from '../lib/battleship'
import BattleGrid, { type Shots } from '../components/BattleGrid'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer } from '../lib/player'
import { ArrowLeft } from '../icons'

const CY = '#3df5ff'
const course = COURSES[0] // Algebra 1 (from profile later)

type Phase = 'unit' | 'subunit' | 'place' | 'battle' | 'over'
interface Battle { enemy: Ship[]; placed: Ship[]; pShots: Shots; eShots: Shots; phase: 'q' | 'aim'; q: Question; msg: string; busy: boolean }

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

  // placement
  const [placed, setPlaced] = useState<Ship[]>([])
  const [orient, setOrient] = useState(true)
  const [hover, setHover] = useState<Cell | null>(null)

  const [battle, setBattle] = useState<Battle | null>(null)
  const [winner, setWinner] = useState<'you' | 'ai' | null>(null)
  const [rewarded, setRewarded] = useState(false)

  // Game-over detection.
  useEffect(() => {
    if (ph !== 'battle' || !battle) return
    if (allSunk(battle.enemy)) { setWinner('you'); setPh('over') }
    else if (allSunk(battle.placed)) { setWinner('ai'); setPh('over') }
  }, [battle, ph])

  useEffect(() => {
    if (ph === 'over' && !rewarded) {
      finishGame('battleship', winner === 'you' ? 3000 : 500)
      setRewarded(true)
    }
  }, [ph, rewarded, winner, finishGame])

  // ----- placement helpers -----
  const nextDef = FLEET[placed.length]
  const previewCells = hover && nextDef ? shipCells(hover.r, hover.c, nextDef.size, orient) : []
  const previewOk = nextDef ? placementOk(previewCells, placed) : false

  function placeCell(r: number, c: number) {
    if (!nextDef) return
    const cells = shipCells(r, c, nextDef.size, orient)
    if (placementOk(cells, placed)) setPlaced([...placed, { id: nextDef.id, size: nextDef.size, cells, hits: 0 }])
  }
  function startBattle() {
    if (!sub) return
    setBattle({ enemy: randomFleet(), placed, pShots: {}, eShots: {}, phase: 'q', q: randomQ(sub), msg: '', busy: false })
    setPh('battle')
  }

  // ----- battle helpers -----
  function onAnswer(correct: boolean) {
    setBattle((b) => b && { ...b, phase: correct ? 'aim' : b.phase, msg: correct ? 'Correct! Take your shot.' : 'Wrong! Enemy returns fire…' })
    if (!correct) aiTurn()
  }
  function fireAtEnemy(r: number, c: number) {
    setBattle((b) => {
      if (!b || b.phase !== 'aim' || b.pShots[keyOf(r, c)]) return b
      const { ships, result } = applyFire(b.enemy, r, c)
      const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
      const pShots = { ...b.pShots, [keyOf(r, c)]: mark }
      return { ...b, enemy: ships, pShots, msg: result === 'sunk' ? 'Enemy ship SUNK!' : result === 'hit' ? 'Direct hit!' : 'Splash — miss.' }
    })
    aiTurn()
  }
  function aiTurn() {
    setBattle((b) => (b ? { ...b, busy: true } : b))
    setTimeout(() => {
      setBattle((b) => {
        if (!b || allSunk(b.enemy)) return b // player already won
        const cell = aiPick(new Set(Object.keys(b.eShots)))
        const { ships, result } = applyFire(b.placed, cell.r, cell.c)
        const mark: 'hit' | 'miss' = result === 'miss' ? 'miss' : 'hit'
        const eShots = { ...b.eShots, [keyOf(cell.r, cell.c)]: mark }
        if (allSunk(ships)) return { ...b, placed: ships, eShots, busy: false }
        if (!sub) return { ...b, placed: ships, eShots, busy: false }
        return { ...b, placed: ships, eShots, phase: 'q', q: randomQ(sub), msg: '', busy: false }
      })
    }, 800)
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
          <div className="w-10" />
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
                <button key={s.id} onClick={() => { setSub(s); setPlaced([]); setPh('place') }}
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
          <Section title="PLACE YOUR FLEET">
            <p className="text-center text-sm text-white/50 mb-1">Tap to place your {nextDef ? `${nextDef.size}-cell ship` : 'fleet'} · ships can’t touch</p>
            <p className="text-center text-xs text-white/40 mb-4">{placed.length} / {FLEET.length} placed</p>
            <div className="flex justify-center mb-4" onMouseLeave={() => setHover(null)}>
              <BattleGrid ships={placed} shots={{}} showShips color={CY} onCell={placeCell} onHover={(r, c) => setHover({ r, c })}
                preview={placed.length < FLEET.length ? previewCells : []} previewOk={previewOk} />
            </div>
            <div className="flex justify-center gap-2.5 flex-wrap">
              <Btn onClick={() => setOrient((o) => !o)}>ROTATE ({orient ? 'H' : 'V'})</Btn>
              <Btn onClick={() => setPlaced(randomFleet())}>AUTO</Btn>
              <Btn onClick={() => setPlaced([])}>RESET</Btn>
              <button onClick={startBattle} disabled={placed.length < FLEET.length}
                className="font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-40" style={{ background: CY, boxShadow: placed.length < FLEET.length ? 'none' : `0 0 16px ${CY}88` }}>
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
              <BattleGrid ships={battle.enemy} shots={battle.pShots} showShips={false} color="#ff4d8d"
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
                <BattleGrid ships={battle.placed} shots={battle.eShots} showShips color="#3df5ff" disabled small />
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
