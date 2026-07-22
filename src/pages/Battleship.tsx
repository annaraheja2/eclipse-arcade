import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { COURSES, type Unit, type Subunit, type Question } from '../data/subjects'
import {
  N, shipCells, placementOk, randomFleet, allSunk, isSunk, keyOf, aiPick,
  shipAt, isHoriz, anchorOf, moveShip, rotateShip, nearestValidAnchor,
  shipClass, CLASS_NAMES,
  type Ship, type Cell,
} from '../lib/battleship'
import BattleGrid, { type Shots, type PlacePhase } from '../components/BattleGrid'
import QuestionPanel from '../components/QuestionPanel'
import { usePlayer } from '../lib/player'
import { ArrowLeft, Volume, VolumeMute, Target, Rotate } from '../icons'
import { sfxFire, sfxHit, sfxMiss, sfxSink, sfxWin, sfxPick, sfxDrop, sfxRotate, sfxDeny, setMuted, isMuted } from '../lib/sound'

const CY = '#3df5ff'
// accent vars for the `.arcade-btn` chunky-button chrome (see index.css)
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}
const course = COURSES[0] // Algebra 1 (from profile later)

function impactSound(result: 'miss' | 'hit' | 'sunk') {
  sfxFire()
  setTimeout(() => (result === 'miss' ? sfxMiss() : result === 'sunk' ? sfxSink() : sfxHit()), 320)
}

type Phase = 'unit' | 'subunit' | 'place' | 'battle' | 'over'
// (r,c) reaching the placement handlers during a drag is the ship's suggested
// anchor (computed by BattleGrid from where the ship floats), not the pointer cell.
interface Drag { id: string; anchor: Cell; ok: boolean }
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

  // placement — all ships start placed; player rearranges via drag / tap / keyboard.
  const [placed, setPlaced] = useState<Ship[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [shaking, setShaking] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const lastTap = useRef<{ id: string; t: number }>({ id: '', t: 0 })
  const suppressUp = useRef(false)
  const shakeTimer = useRef<number | undefined>(undefined)

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

  // Ensure a fleet exists and one ship is selected whenever we enter placement
  // (covers PLAY AGAIN and gives keyboard-only players a starting selection).
  useEffect(() => {
    if (ph !== 'place') return
    if (placed.length === 0) { setPlaced(randomFleet()); return }
    if (!selectedId) setSelectedId(placed[0].id)
  }, [ph, placed, selectedId])

  // Keyboard placement: [ ] switch ship, arrows nudge the selected ship, R rotates it.
  useEffect(() => {
    if (ph !== 'place') return
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || placed.length === 0) return
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const i = placed.findIndex((s) => s.id === selectedId)
        const next = (i + (e.key === ']' ? 1 : placed.length - 1) + placed.length) % placed.length
        setSelectedId(placed[next].id)
        return
      }
      const ship = placed.find((s) => s.id === selectedId)
      if (!ship) return
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotate(selectedId); return }
      const nudge: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      const d = nudge[e.key]
      if (!d) return
      e.preventDefault()
      const a = anchorOf(ship.cells)
      const cells = shipCells(a.r + d[0], a.c + d[1], ship.size, isHoriz(ship.cells))
      const others = placed.filter((s) => s.id !== selectedId)
      if (placementOk(cells, others)) setPlaced((cur) => cur.map((s) => (s.id === selectedId ? { ...s, cells } : s)))
      else triggerShake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ph, selectedId, placed])

  // ----- placement helpers -----
  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d) }
  function triggerShake() {
    sfxDeny()
    setShaking(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShaking(false), 420)
  }
  useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  // Where the ship would land: raw target if legal, else nearest legal cell within reach.
  function landing(ship: Ship, targetR: number, targetC: number): { anchor: Cell; ok: boolean } {
    const horiz = isHoriz(ship.cells)
    const others = placed.filter((s) => s.id !== ship.id)
    if (placementOk(shipCells(targetR, targetC, ship.size, horiz), others)) return { anchor: { r: targetR, c: targetC }, ok: true }
    const snap = nearestValidAnchor(ship.size, horiz, targetR, targetC, others, 2)
    if (snap) return { anchor: snap, ok: true }
    const maxR = horiz ? N - 1 : N - ship.size, maxC = horiz ? N - ship.size : N - 1
    return { anchor: { r: Math.max(0, Math.min(maxR, targetR)), c: Math.max(0, Math.min(maxC, targetC)) }, ok: false }
  }
  function commitTo(ship: Ship, targetR: number, targetC: number) {
    const { anchor, ok } = landing(ship, targetR, targetC)
    if (!ok) { triggerShake(); return }
    const cur = anchorOf(ship.cells)
    if (anchor.r === cur.r && anchor.c === cur.c) return // no movement — no thunk
    sfxDrop()
    setPlaced((all) => all.map((s) => (s.id === ship.id ? moveShip(s, anchor.r, anchor.c) : s)))
  }
  function rotate(id: string) {
    const ship = placed.find((s) => s.id === id)
    if (!ship) return
    const others = placed.filter((s) => s.id !== id)
    const rotated = rotateShip(ship)
    if (placementOk(rotated.cells, others)) { sfxRotate(); setPlaced((cur) => cur.map((s) => (s.id === id ? rotated : s))); return }
    const a = anchorOf(ship.cells)
    const snap = nearestValidAnchor(ship.size, !isHoriz(ship.cells), a.r, a.c, others, 2)
    if (snap) { sfxRotate(); setPlaced((cur) => cur.map((s) => (s.id === id ? moveShip(rotated, snap.r, snap.c) : s))) }
    else triggerShake()
  }

  function onPlacePointer(r: number, c: number, phase: PlacePhase) {
    if (phase === 'down') {
      const ship = shipAt(placed, r, c)
      if (ship) {
        const now = Date.now()
        const isDouble = lastTap.current.id === ship.id && now - lastTap.current.t < 320
        lastTap.current = { id: ship.id, t: now }
        setSelectedId(ship.id)
        if (isDouble) { suppressUp.current = true; rotate(ship.id); return } // second tap on a ship rotates it
        sfxPick()
        setDragBoth({ id: ship.id, anchor: anchorOf(ship.cells), ok: true })
      } else {
        lastTap.current = { id: '', t: 0 } // water tap resolves on release (tap-to-move)
      }
    } else if (phase === 'move') {
      const d = dragRef.current
      if (!d) return
      const ship = placed.find((s) => s.id === d.id)
      if (!ship) return
      const { anchor, ok } = landing(ship, r, c)
      setDragBoth({ ...d, anchor, ok })
    } else { // up
      const d = dragRef.current
      setDragBoth(null)
      if (suppressUp.current) { suppressUp.current = false; return }
      if (d) { const ship = placed.find((s) => s.id === d.id); if (ship) commitTo(ship, r, c) }
      else if (selectedId) { const ship = placed.find((s) => s.id === selectedId); if (ship) commitTo(ship, r, c) }
    }
  }

  function shuffle() { setPlaced(randomFleet()); setSelectedId(null); setDragBoth(null) }
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

  const dragShip = drag ? placed.find((s) => s.id === drag.id) : undefined
  const previewCells = drag && dragShip ? shipCells(drag.anchor.r, drag.anchor.c, dragShip.size, isHoriz(dragShip.cells)) : undefined

  // ================= RENDER =================
  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button aria-label="Back" onClick={ph === 'unit' ? back : () => resetTo(ph, setPh, setUnit, setSub, setPlaced)} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white"><ArrowLeft width={18} height={18} /></button>
          <div className="font-pixel text-[12px]" style={{ color: CY }}>BATTLESHIP</div>
          <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const m = !muted; setMuted(m); setMutedState(m) }} className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">{muted ? <VolumeMute width={18} height={18} /> : <Volume width={18} height={18} />}</button>
        </div>

        {ph === 'unit' && (
          <Section title="CHOOSE A UNIT">
            <div className="grid gap-3 sm:grid-cols-2">
              {course.units.map((u) => (
                <button key={u.id} onClick={() => { setUnit(u); setPh('subunit') }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-neon-cyan/60 transition">
                  <div className="font-bold">{u.name}</div>
                  <div className="text-xs text-white/60 mt-1">{u.subunits.length} topics</div>
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
                  <div className="text-xs text-white/60 mt-1 uppercase tracking-wide">{s.type} · vs AI</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {ph === 'place' && (
          <Section title="DEPLOY YOUR FLEET">
            <p className="text-center text-sm text-white/65 mb-3">Drag a ship to move it · double-tap or R rotates · arrows nudge · [ ] switch ship · ships can’t touch</p>
            <div className="flex justify-center gap-2 flex-wrap mb-4" role="group" aria-label="Select a ship">
              {placed.map((s) => {
                const sel = s.id === selectedId
                return (
                  <button key={s.id} onClick={() => setSelectedId(s.id)} aria-pressed={sel}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${sel
                      ? 'border-[#ffd23d] bg-[#ffd23d]/10 text-white shadow-[0_0_12px_rgba(255,210,61,0.35)]'
                      : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-white/30 hover:text-white'}`}>
                    <span className="font-pixel text-[8px] tracking-wide">{CLASS_NAMES[shipClass(s.id)].toUpperCase()}</span>
                    <span className="flex gap-[3px]" aria-hidden="true">
                      {Array.from({ length: s.size }).map((_, i) => (
                        <span key={i} className="w-[5px] h-[5px] rounded-[1px]" style={{ background: sel ? '#ffd23d' : 'rgba(255,255,255,0.35)' }} />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-center mb-5">
              <BattleGrid ships={placed} shots={{}} showShips placement selected={selectedId ?? undefined}
                onPlacePointer={onPlacePointer} preview={previewCells} previewOk={drag?.ok} draggingId={drag?.id} shake={shaking} />
            </div>
            <div className="flex justify-center gap-2.5 flex-wrap">
              <Btn onClick={() => selectedId && rotate(selectedId)}><span className="inline-flex items-center gap-1.5"><Rotate width={13} height={13} />ROTATE</span></Btn>
              <Btn onClick={shuffle}>SHUFFLE</Btn>
              <button onClick={startBattle}
                className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620]"
                style={CY_BTN}>
                START BATTLE
              </button>
            </div>
          </Section>
        )}

        {ph === 'battle' && battle && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <FleetPips ships={battle.enemy} color="#ff4d8d" label={`ENEMY ${remaining(battle.enemy)}`} />
              <FleetPips ships={battle.placed} color={CY} label={`FLEET ${remaining(battle.placed)}`} align="right" />
            </div>

            <div className="text-center mb-2">
              <div className="font-pixel text-[10px] text-white/60">ENEMY WATERS</div>
            </div>
            <div className="flex justify-center mb-4">
              <BattleGrid ships={battle.enemy} shots={battle.pShots} showShips={false} lastShot={battle.lastP}
                disabled={battle.phase !== 'aim' || battle.busy} onCell={fireAtEnemy} />
            </div>

            <div className="h-6 text-center font-pixel text-[11px] mb-2" style={{ color: CY }} aria-live="polite">{battle.msg}</div>

            {battle.phase === 'q' && !battle.busy
              ? <QuestionPanel q={battle.q} color={CY} onSubmit={onAnswer} />
              : battle.phase === 'aim'
                ? <p className="flex items-center justify-center gap-2 text-white/70 text-sm mb-4"><Target width={16} height={16} className="text-neon-cyan" />Tap the enemy waters to fire!</p>
                : <p className="text-center text-white/60 text-sm mb-4">Enemy is firing…</p>}

            <div className="mt-5">
              <div className="text-center font-pixel text-[9px] text-white/60 mb-1">YOUR FLEET</div>
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
              <button onClick={() => { setPlaced(randomFleet()); setSelectedId(null); setBattle(null); setWinner(null); setRewarded(false); setPh('place') }}
                className="arcade-btn font-pixel text-[11px] px-5 py-3 rounded-lg text-[#0a0620]" style={CY_BTN}>PLAY AGAIN</button>
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
  return <button onClick={onClick} className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 transition-all hover:bg-white/10 hover:border-neon-cyan/40 active:scale-95">{children}</button>
}
function FleetPips({ ships, color, label, align }: { ships: Ship[]; color: string; label: string; align?: 'right' }) {
  return (
    <div className={`flex items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span className="font-pixel text-[8px] text-white/60">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {ships.map((s) => (
          <span key={s.id} className="h-[6px] rounded-[2px] transition-all" style={{
            width: s.size * 5,
            background: isSunk(s) ? 'rgba(255,255,255,0.14)' : color,
            boxShadow: isSunk(s) ? 'none' : `0 0 6px ${color}99`,
          }} />
        ))}
      </span>
    </div>
  )
}
function DiffBadge({ d }: { d: 'easy' | 'medium' | 'hard' }) {
  const c = d === 'easy' ? '#3dffa2' : d === 'medium' ? '#ffb43d' : '#ff4d8d'
  return <span className="text-[9px] font-pixel px-2 py-1 rounded" style={{ background: `${c}22`, color: c }}>{d.toUpperCase()}</span>
}
