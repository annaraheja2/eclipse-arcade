import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { N, isSunk, isHoriz, anchorOf, shipAt, type Cell, type Ship } from '../lib/battleship'
import Warship from './Warship'

export type Shots = Record<string, 'hit' | 'miss'>
export type PlacePhase = 'down' | 'move' | 'up'

const SPARK_ANGLES = [15, 75, 135, 195, 255, 315]

// Live geometry of a grab: the ship's floating top-left in px, tracked 1:1 with the
// pointer (imperatively — no React re-render per pixel). React only hears about it
// when the snapped anchor cell changes.
interface DragGeom {
  id: string
  grabX: number; grabY: number
  x: number; y: number
  w: number; h: number
  maxR: number; maxC: number
  lastR: number; lastC: number
  tilt: number; lastPX: number
}

export default function BattleGrid({
  ships, shots, onCell, showShips, preview, previewOk, disabled, small, lastShot, selected,
  placement, onPlacePointer, shake, draggingId,
}: {
  ships: Ship[]
  shots: Shots
  onCell?: (r: number, c: number) => void
  showShips?: boolean
  preview?: Cell[]
  previewOk?: boolean
  disabled?: boolean
  small?: boolean
  lastShot?: string
  selected?: string
  placement?: boolean
  onPlacePointer?: (r: number, c: number, phase: PlacePhase) => void
  shake?: boolean
  draggingId?: string
}) {
  const CELL = small ? 26 : 40
  const GAP = 3, PAD = 6, PITCH = CELL + GAP
  const LABEL = small ? 0 : 16
  const dim = N * CELL + (N - 1) * GAP + 2 * PAD
  const span = (n: number) => n * CELL + (n - 1) * GAP
  const at = (r: number, c: number) => ({ x: PAD + c * PITCH, y: PAD + r * PITCH })
  const center = (r: number, c: number) => ({ left: PAD + c * PITCH + CELL / 2, top: PAD + r * PITCH + CELL / 2 })

  const oceanRef = useRef<HTMLDivElement>(null)
  const floatEl = useRef<HTMLDivElement>(null)
  const geom = useRef<DragGeom | null>(null)
  const [settling, setSettling] = useState<string | null>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  // A hit rocks the whole board (a decaying thud, delayed to the shell's
  // impact — see .board-shake). Class reset + reflow retriggers it so
  // back-to-back hits each land their own shake; reduced-motion CSS stills it.
  useEffect(() => {
    const el = oceanRef.current
    if (!el || !lastShot || shots[lastShot] !== 'hit') return
    el.classList.remove('board-shake')
    void el.offsetWidth // reflow so the animation restarts
    el.classList.add('board-shake')
    const t = window.setTimeout(() => el.classList.remove('board-shake'), 700)
    return () => window.clearTimeout(t)
  }, [lastShot, shots])

  const clampCell = (v: number) => Math.max(0, Math.min(N - 1, v))
  function ptOf(e: { clientX: number; clientY: number }) {
    const rect = oceanRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const cellOf = (pt: { x: number; y: number }): Cell => ({
    r: clampCell(Math.floor((pt.y - PAD) / PITCH)),
    c: clampCell(Math.floor((pt.x - PAD) / PITCH)),
  })

  function beginDrag(pt: { x: number; y: number }) {
    const { r, c } = cellOf(pt)
    const ship = shipAt(ships, r, c)
    if (!ship) { geom.current = null; return }
    const horiz = isHoriz(ship.cells)
    const a = anchorOf(ship.cells)
    const home = at(a.r, a.c)
    geom.current = {
      id: ship.id, grabX: pt.x - home.x, grabY: pt.y - home.y, x: home.x, y: home.y,
      w: horiz ? span(ship.size) : CELL, h: horiz ? CELL : span(ship.size),
      maxR: horiz ? N - 1 : N - ship.size, maxC: horiz ? N - ship.size : N - 1,
      lastR: a.r, lastC: a.c, tilt: 0, lastPX: pt.x,
    }
  }

  const floatTransform = (g: DragGeom) => `translate(${g.x}px, ${g.y}px) rotate(${g.tilt.toFixed(2)}deg) scale(1.07)`

  // Track the pointer 1:1 with a little velocity tilt; return the snapped anchor.
  function dragTo(pt: { x: number; y: number }): Cell {
    const g = geom.current!
    const slack = 5
    g.x = Math.max(PAD - slack, Math.min(dim - PAD - g.w + slack, pt.x - g.grabX))
    g.y = Math.max(PAD - slack, Math.min(dim - PAD - g.h + slack, pt.y - g.grabY))
    const raw = Math.max(-7, Math.min(7, (pt.x - g.lastPX) * 0.9))
    g.tilt = g.tilt * 0.8 + raw * 0.2
    g.lastPX = pt.x
    if (floatEl.current) floatEl.current.style.transform = floatTransform(g)
    return {
      r: Math.max(0, Math.min(g.maxR, Math.round((g.y - PAD) / PITCH))),
      c: Math.max(0, Math.min(g.maxC, Math.round((g.x - PAD) / PITCH))),
    }
  }

  function endDrag(e: React.PointerEvent) {
    const pt = ptOf(e)
    const g = geom.current
    geom.current = null
    if (g) {
      // Suggested anchor comes from where the ship itself floats, not the pointer.
      setSettling(g.id)
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => setSettling(null), 260)
      onPlacePointer?.(
        Math.max(0, Math.min(g.maxR, Math.round((g.y - PAD) / PITCH))),
        Math.max(0, Math.min(g.maxC, Math.round((g.x - PAD) / PITCH))),
        'up',
      )
    } else {
      const { r, c } = cellOf(pt)
      onPlacePointer?.(r, c, 'up')
    }
  }

  const placeProps = placement
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const pt = ptOf(e)
          beginDrag(pt)
          const { r, c } = cellOf(pt)
          onPlacePointer?.(r, c, 'down')
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (e.buttons === 0 && e.pointerType === 'mouse') return
          const pt = ptOf(e)
          if (geom.current) {
            const s = dragTo(pt)
            if (s.r !== geom.current.lastR || s.c !== geom.current.lastC) {
              geom.current.lastR = s.r; geom.current.lastC = s.c
              onPlacePointer?.(s.r, s.c, 'move')
            }
          } else {
            const { r, c } = cellOf(pt)
            onPlacePointer?.(r, c, 'move')
          }
        },
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
      }
    : {}

  // The ship that renders on the float layer: the one being dragged, or the one settling.
  const floatId = draggingId ?? settling ?? undefined
  const floatShip = floatId ? ships.find((s) => s.id === floatId) : undefined

  // Landing ghost — one footprint, not per-cell blocks.
  let ghost: { x: number; y: number; w: number; h: number } | null = null
  if (preview && preview.length > 0) {
    const rs = preview.map((p) => p.r), cs = preview.map((p) => p.c)
    const p = at(Math.min(...rs), Math.min(...cs))
    const gh = rs.every((v) => v === rs[0])
    ghost = { x: p.x, y: p.y, w: gh ? span(preview.length) : CELL, h: gh ? CELL : span(preview.length) }
  }

  return (
    <div className="relative inline-block">
      {/* coordinate labels */}
      {LABEL > 0 && Array.from({ length: N }).map((_, c) => (
        <div key={`c${c}`} className="absolute text-[9px] font-semibold text-cyan-100/60 text-center" style={{ left: LABEL + PAD + c * PITCH, top: 2, width: CELL }}>{c + 1}</div>
      ))}
      {LABEL > 0 && Array.from({ length: N }).map((_, r) => (
        <div key={`r${r}`} className="absolute text-[9px] font-semibold text-cyan-100/60 grid place-items-center" style={{ top: LABEL + PAD + r * PITCH, left: 0, width: LABEL, height: CELL }}>{String.fromCharCode(65 + r)}</div>
      ))}

      <div
        ref={oceanRef}
        className={`relative ocean rounded-xl border border-cyan-200/40 ${shake ? 'reject-shake' : ''} ${placement ? 'touch-none select-none' : ''}`}
        style={{
          width: dim, height: dim, marginLeft: LABEL, marginTop: LABEL,
          boxShadow: '0 0 26px rgba(61,245,255,0.14), 0 6px 22px rgba(0,0,0,0.4), inset 0 0 34px rgba(0,10,25,0.55)',
        }}
        {...placeProps}
      >
        {/* grid cells */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N}, ${CELL}px)`, gap: `${GAP}px`, padding: `${PAD}px` }}>
          {Array.from({ length: N * N }).map((_, i) => {
            const r = Math.floor(i / N), c = i % N
            const interactive = !placement && !disabled
            return (
              <button key={i} disabled={disabled || placement} onClick={placement ? undefined : () => onCell?.(r, c)}
                tabIndex={placement ? -1 : undefined}
                aria-label={`${String.fromCharCode(65 + r)}${c + 1}`}
                className={`rounded-[3px] border transition ${interactive ? 'border-cyan-100/20 hover:bg-cyan-300/25 hover:border-cyan-200/80 cursor-crosshair' : 'border-cyan-100/15'}`}
                style={{ background: 'rgba(130,200,240,0.08)', pointerEvents: placement ? 'none' : undefined }} />
            )
          })}
        </div>

        {/* depth vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(120% 100% at 50% 0%, transparent 55%, rgba(2,10,20,0.35) 100%)' }} />

        {/* landing ghost — glides between cells */}
        {ghost && (
          <div className="absolute left-0 top-0 pointer-events-none rounded-md" style={{
            width: ghost.w, height: ghost.h,
            transform: `translate(${ghost.x}px, ${ghost.y}px)`,
            transition: 'transform 90ms ease-out, border-color 120ms, background-color 120ms, box-shadow 120ms',
            border: `2px dashed ${previewOk ? '#3dffa2' : '#ff5a7a'}`,
            background: previewOk ? 'rgba(61,255,162,0.10)' : 'rgba(255,90,122,0.13)',
            boxShadow: `0 0 12px ${previewOk ? 'rgba(61,255,162,0.35)' : 'rgba(255,90,122,0.35)'}`,
          }} />
        )}

        {/* ships */}
        <div className="absolute inset-0 pointer-events-none">
          {ships.filter((sh) => showShips || isSunk(sh)).map((sh, idx) => {
            const horiz = isHoriz(sh.cells)
            const a = anchorOf(sh.cells)
            const p = at(a.r, a.c)
            const w = horiz ? span(sh.size) : CELL
            const h = horiz ? CELL : span(sh.size)
            const sel = placement && sh.id === selected
            const hidden = sh.id === floatId
            return (
              <div key={sh.id} className="absolute left-0 top-0" style={{
                width: w, height: h,
                transform: `translate(${p.x}px, ${p.y}px)`,
                transition: 'transform 200ms cubic-bezier(0.25, 1.35, 0.4, 1)',
                opacity: hidden ? 0 : 1,
              }}>
                {sel && !hidden && <div className="sel-ring" />}
                <div className="w-full h-full" style={{
                  animation: isSunk(sh) ? 'none' : `bob ${3.4 + idx * 0.4}s ease-in-out ${idx * 0.35}s infinite`,
                  filter: 'drop-shadow(0 3px 4px rgba(0,8,18,0.5))',
                }}>
                  <Warship shipId={sh.id} aspect={span(sh.size) / CELL} horiz={horiz} sunk={isSunk(sh)} />
                </div>
              </div>
            )
          })}
        </div>

        {/* float layer: dragged ship tracks the pointer; on release it springs into its cell */}
        {floatShip && (() => {
          const horiz = isHoriz(floatShip.cells)
          const w = horiz ? span(floatShip.size) : CELL
          const h = horiz ? CELL : span(floatShip.size)
          const a = anchorOf(floatShip.cells)
          const home = at(a.r, a.c)
          const g = geom.current
          const lifted = floatShip.id === draggingId && !!g
          return (
            <div ref={floatEl} className="absolute left-0 top-0 z-20 pointer-events-none will-change-transform" style={{
              width: w, height: h,
              transform: lifted && g ? floatTransform(g) : `translate(${home.x}px, ${home.y}px) rotate(0deg) scale(1)`,
              transition: lifted ? 'none' : 'transform 240ms cubic-bezier(0.2, 1.5, 0.35, 1)',
              filter: lifted
                ? 'drop-shadow(0 9px 12px rgba(0,6,14,0.55)) drop-shadow(0 0 10px rgba(61,245,255,0.25))'
                : 'drop-shadow(0 3px 4px rgba(0,8,18,0.5))',
            }}>
              <div className="w-full h-full float-lift">
                <Warship shipId={floatShip.id} aspect={span(floatShip.size) / CELL} horiz={horiz} sunk={false} />
              </div>
            </div>
          )
        })()}

        {/* impact effects */}
        <div className="absolute inset-0 pointer-events-none">
          {Object.entries(shots).map(([k, res]) => {
            const [r, c] = k.split(',').map(Number)
            const ctr = center(r, c)
            return (
              <div key={k} className="absolute" style={{ left: ctr.left, top: ctr.top }}>
                {res === 'hit' ? (
                  <>
                    <span className="hit-scorch" />
                    <span className="fx-burst-ring" />
                    <span className="fx-burst" />
                    {SPARK_ANGLES.map((a) => (
                      <span key={a} className="fx-spark" style={{ '--a': `${a}deg` } as CSSProperties} />
                    ))}
                    <span className="fx-smoke" />
                    <span className="hit-ember" />
                  </>
                ) : (
                  <>
                    <span className="fx-plop-ring" />
                    <span className="fx-plop-ring fx-plop-ring2" />
                    <span className="fx-plop" />
                    <span className="fx-droplet" />
                    <span className="miss-dot" />
                  </>
                )}
                {k === lastShot && <span className="fx-shell" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
