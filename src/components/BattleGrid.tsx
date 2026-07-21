import { N, keyOf, isSunk, type Cell, type Ship } from '../lib/battleship'
import Warship from './Warship'

export type Shots = Record<string, 'hit' | 'miss'>

export default function BattleGrid({
  ships, shots, onCell, onHover, showShips, preview, previewOk, disabled, small, lastShot,
}: {
  ships: Ship[]
  shots: Shots
  onCell?: (r: number, c: number) => void
  onHover?: (r: number, c: number) => void
  showShips?: boolean
  preview?: Cell[]
  previewOk?: boolean
  disabled?: boolean
  small?: boolean
  lastShot?: string
}) {
  const CELL = small ? 26 : 40
  const GAP = 3, PAD = 6, PITCH = CELL + GAP
  const dim = N * CELL + (N - 1) * GAP + 2 * PAD
  const previewSet = new Set((preview ?? []).map((x) => keyOf(x.r, x.c)))
  const at = (r: number, c: number) => ({ left: PAD + c * PITCH, top: PAD + r * PITCH })
  const center = (r: number, c: number) => ({ left: PAD + c * PITCH + CELL / 2, top: PAD + r * PITCH + CELL / 2 })

  return (
    <div className="relative ocean rounded-xl border border-white/20" style={{ width: dim, height: dim }}>
      {/* water tiles (clickable) */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N}, ${CELL}px)`, gap: `${GAP}px`, padding: `${PAD}px` }}>
        {Array.from({ length: N * N }).map((_, i) => {
          const r = Math.floor(i / N), c = i % N
          const inPrev = previewSet.has(keyOf(r, c))
          const bg = inPrev ? (previewOk ? 'rgba(61,255,162,0.5)' : 'rgba(255,90,90,0.55)') : 'transparent'
          return (
            <button key={i} disabled={disabled} onClick={() => onCell?.(r, c)} onMouseEnter={() => onHover?.(r, c)}
              className={`rounded-[3px] ${disabled ? '' : 'hover:bg-cyan-300/25 hover:shadow-[inset_0_0_0_2px_rgba(120,240,255,0.7)] cursor-crosshair'} transition`}
              style={{ background: bg }} />
          )
        })}
      </div>

      {/* ships */}
      <div className="absolute inset-0 pointer-events-none">
        {ships.filter((sh) => showShips || isSunk(sh)).map((sh, i) => {
          const rs = sh.cells.map((x) => x.r), cs = sh.cells.map((x) => x.c)
          const minR = Math.min(...rs), minC = Math.min(...cs)
          const horiz = rs.every((v) => v === rs[0])
          const p = at(minR, minC)
          const w = horiz ? sh.size * CELL + (sh.size - 1) * GAP : CELL
          const h = horiz ? CELL : sh.size * CELL + (sh.size - 1) * GAP
          return (
            <div key={sh.id} className="absolute" style={{
              left: p.left, top: p.top, width: w, height: h, padding: 2,
              animation: isSunk(sh) ? 'none' : `bob ${3.4 + i * 0.4}s ease-in-out ${i * 0.35}s infinite`,
            }}>
              <Warship size={sh.size} horiz={horiz} sunk={isSunk(sh)} />
            </div>
          )
        })}
      </div>

      {/* impact effects */}
      <div className="absolute inset-0 pointer-events-none">
        {Object.entries(shots).map(([k, res]) => {
          const [r, c] = k.split(',').map(Number)
          const ctr = center(r, c)
          return (
            <div key={k} className="absolute" style={{ left: ctr.left, top: ctr.top }}>
              {res === 'hit' ? <><span className="fx-fire" /><span className="fx-smoke" /></> : <><span className="fx-splash" /><span className="miss-dot" /></>}
              {k === lastShot && <span className="fx-shell" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
