import { N, keyOf, shipAt, isSunk, type Cell, type Ship } from '../lib/battleship'

export type Shots = Record<string, 'hit' | 'miss'>

export default function BattleGrid({
  ships, shots, onCell, onHover, showShips, preview, previewOk, color, disabled, small,
}: {
  ships: Ship[]
  shots: Shots
  onCell?: (r: number, c: number) => void
  onHover?: (r: number, c: number) => void
  showShips?: boolean
  preview?: Cell[]
  previewOk?: boolean
  color: string
  disabled?: boolean
  small?: boolean
}) {
  const previewSet = new Set((preview ?? []).map((x) => keyOf(x.r, x.c)))
  const size = small ? 30 : 40
  return (
    <div className="inline-grid gap-1 p-2 rounded-xl bg-black/30 border border-white/10"
      style={{ gridTemplateColumns: `repeat(${N}, ${size}px)` }}>
      {Array.from({ length: N * N }).map((_, i) => {
        const r = Math.floor(i / N), c = i % N
        const k = keyOf(r, c)
        const shot = shots[k]
        const occ = shipAt(ships, r, c)
        const sunk = occ && isSunk(occ)
        const showShip = (showShips && occ) || (sunk) // reveal sunk enemy ships
        const inPrev = previewSet.has(k)

        let bg = 'rgba(255,255,255,0.04)'
        if (showShip) bg = sunk ? 'rgba(255,80,80,0.35)' : `${color}44`
        if (inPrev) bg = previewOk ? 'rgba(61,255,162,0.5)' : 'rgba(255,80,80,0.5)'

        return (
          <button
            key={i}
            disabled={disabled}
            onClick={() => onCell?.(r, c)}
            onMouseEnter={() => onHover?.(r, c)}
            className={`rounded-[5px] border border-white/10 grid place-items-center ${disabled ? '' : 'hover:border-white/40'} transition`}
            style={{ width: size, height: size, background: bg }}
          >
            {shot === 'hit' && <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5a5a', boxShadow: '0 0 8px #ff5a5a' }} />}
            {shot === 'miss' && <span className="w-1.5 h-1.5 rounded-full bg-white/40" />}
          </button>
        )
      })}
    </div>
  )
}
