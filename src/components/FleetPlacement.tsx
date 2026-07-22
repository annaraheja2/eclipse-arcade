import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  N, shipCells, placementOk, randomFleet,
  shipAt, isHoriz, anchorOf, moveShip, rotateShip, nearestValidAnchor,
  shipClass, CLASS_NAMES,
  type Ship, type Cell,
} from '../lib/battleship'
import BattleGrid, { type PlacePhase } from './BattleGrid'
import { Rotate } from '../icons'
import { sfxPick, sfxDrop, sfxRotate, sfxDeny } from '../lib/sound'

// (r,c) reaching the placement handlers during a drag is the ship's suggested
// anchor (computed by BattleGrid from where the ship floats), not the pointer cell.
interface Drag { id: string; anchor: Cell; ok: boolean }

/**
 * The full fleet-deployment UX — ship roster, drag/tap/keyboard placement on
 * the ocean grid, ROTATE and SHUFFLE — shared by the vs-AI and PvP screens.
 * The parent owns the fleet (`placed`) and supplies the primary action button
 * (START BATTLE / READY) via `actions`.
 */
export default function FleetPlacement({ placed, onChange, actions }: {
  placed: Ship[]
  onChange: (ships: Ship[]) => void
  actions: ReactNode
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [shaking, setShaking] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const lastTap = useRef<{ id: string; t: number }>({ id: '', t: 0 })
  const suppressUp = useRef(false)
  const shakeTimer = useRef<number | undefined>(undefined)

  // Ensure a fleet exists and one ship is selected (gives keyboard-only
  // players a starting selection).
  useEffect(() => {
    if (placed.length === 0) { onChange(randomFleet()); return }
    if (!selectedId || !placed.some((s) => s.id === selectedId)) setSelectedId(placed[0].id)
  }, [placed, selectedId, onChange])

  // Keyboard placement: [ ] switch ship, arrows nudge the selected ship, R rotates it.
  useEffect(() => {
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
      if (placementOk(cells, others)) onChange(placed.map((s) => (s.id === selectedId ? { ...s, cells } : s)))
      else triggerShake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, placed, onChange]) // rotate/triggerShake are per-render and close over exactly these

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
    onChange(placed.map((s) => (s.id === ship.id ? moveShip(s, anchor.r, anchor.c) : s)))
  }
  function rotate(id: string) {
    const ship = placed.find((s) => s.id === id)
    if (!ship) return
    const others = placed.filter((s) => s.id !== id)
    const rotated = rotateShip(ship)
    if (placementOk(rotated.cells, others)) { sfxRotate(); onChange(placed.map((s) => (s.id === id ? rotated : s))); return }
    const a = anchorOf(ship.cells)
    const snap = nearestValidAnchor(ship.size, !isHoriz(ship.cells), a.r, a.c, others, 2)
    if (snap) { sfxRotate(); onChange(placed.map((s) => (s.id === id ? moveShip(rotated, snap.r, snap.c) : s))) }
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

  function shuffle() { onChange(randomFleet()); setSelectedId(null); setDragBoth(null) }

  const dragShip = drag ? placed.find((s) => s.id === drag.id) : undefined
  const previewCells = drag && dragShip ? shipCells(drag.anchor.r, drag.anchor.c, dragShip.size, isHoriz(dragShip.cells)) : undefined

  return (
    <div>
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
        <button onClick={() => selectedId && rotate(selectedId)}
          className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 transition-all hover:bg-white/10 hover:border-neon-cyan/40 active:scale-95">
          <span className="inline-flex items-center gap-1.5"><Rotate width={13} height={13} />ROTATE</span>
        </button>
        <button onClick={shuffle}
          className="font-pixel text-[10px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 transition-all hover:bg-white/10 hover:border-neon-cyan/40 active:scale-95">
          SHUFFLE
        </button>
        {actions}
      </div>
    </div>
  )
}
