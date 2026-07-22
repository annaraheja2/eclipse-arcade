export const N = 8
export const FLEET: { id: string; size: number }[] = [
  { id: 'carrier', size: 4 },
  { id: 'cruiser-1', size: 3 },
  { id: 'cruiser-2', size: 3 },
  { id: 'destroyer-1', size: 2 },
  { id: 'destroyer-2', size: 2 },
]

export interface Cell { r: number; c: number }
export interface Ship { id: string; size: number; cells: Cell[]; hits: number }

// Visual class per fleet id — five distinct silhouettes (art + roster labels key off this).
export type ShipClass = 'carrier' | 'cruiser' | 'submarine' | 'destroyer' | 'patrol'
export function shipClass(id: string): ShipClass {
  if (id.startsWith('carrier')) return 'carrier'
  if (id === 'cruiser-2') return 'submarine'
  if (id.startsWith('cruiser')) return 'cruiser'
  if (id === 'destroyer-2') return 'patrol'
  return 'destroyer'
}
export const CLASS_NAMES: Record<ShipClass, string> = {
  carrier: 'Carrier', cruiser: 'Cruiser', submarine: 'Submarine', destroyer: 'Destroyer', patrol: 'Patrol',
}

export const keyOf = (r: number, c: number) => `${r},${c}`

export function shipCells(r: number, c: number, size: number, horiz: boolean): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < size; i++) cells.push(horiz ? { r, c: c + i } : { r: r + i, c })
  return cells
}

export function inBounds(cells: Cell[]): boolean {
  return cells.every((x) => x.r >= 0 && x.r < N && x.c >= 0 && x.c < N)
}

// "No ships touch" — new cells must not overlap OR be adjacent (incl. diagonal) to existing ships.
export function placementOk(cells: Cell[], existing: Ship[]): boolean {
  if (!inBounds(cells)) return false
  const blocked = new Set<string>()
  for (const sh of existing) {
    for (const cell of sh.cells) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        blocked.add(keyOf(cell.r + dr, cell.c + dc))
      }
    }
  }
  return cells.every((x) => !blocked.has(keyOf(x.r, x.c)))
}

export function randomFleet(): Ship[] {
  const ships: Ship[] = []
  for (const def of FLEET) {
    let placed = false
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const horiz = Math.random() < 0.5
      const r = Math.floor(Math.random() * N)
      const c = Math.floor(Math.random() * N)
      const cells = shipCells(r, c, def.size, horiz)
      if (placementOk(cells, ships)) { ships.push({ id: def.id, size: def.size, cells, hits: 0 }); placed = true }
    }
    if (!placed) return randomFleet() // rare: restart
  }
  return ships
}

export function shipAt(ships: Ship[], r: number, c: number): Ship | undefined {
  return ships.find((sh) => sh.cells.some((x) => x.r === r && x.c === c))
}

// ----- placement geometry (pure) -----

// A ship is horizontal when all its cells share a row.
export const isHoriz = (cells: Cell[]) => cells.every((x) => x.r === cells[0].r)

// Top-left anchor (min row, min col) of a ship's cells.
export const anchorOf = (cells: Cell[]): Cell => ({
  r: Math.min(...cells.map((x) => x.r)),
  c: Math.min(...cells.map((x) => x.c)),
})

// Move a ship so its anchor sits at (r,c), preserving orientation.
export function moveShip(ship: Ship, r: number, c: number): Ship {
  return { ...ship, cells: shipCells(r, c, ship.size, isHoriz(ship.cells)) }
}

// Rotate a ship 90° about its current anchor.
export function rotateShip(ship: Ship): Ship {
  const a = anchorOf(ship.cells)
  return { ...ship, cells: shipCells(a.r, a.c, ship.size, !isHoriz(ship.cells)) }
}

// Nearest legal anchor to a desired (r,c) for a ship of given size/orientation among
// `others`, searching outward by Chebyshev ring. Returns null if none within `maxRadius`.
export function nearestValidAnchor(
  size: number, horiz: boolean, r: number, c: number, others: Ship[], maxRadius = N,
): Cell | null {
  for (let rad = 0; rad <= maxRadius; rad++) {
    let best: Cell | null = null
    let bestD = Infinity
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue // only this ring
      const ar = r + dr, ac = c + dc
      if (!placementOk(shipCells(ar, ac, size, horiz), others)) continue
      const d = dr * dr + dc * dc
      if (d < bestD) { bestD = d; best = { r: ar, c: ac } }
    }
    if (best) return best
  }
  return null
}
export const isSunk = (sh: Ship) => sh.hits >= sh.size
export const allSunk = (ships: Ship[]) => ships.every(isSunk)

// Immutable fire resolution: returns the next fleet plus the shot result.
// Shared by the vs-AI battle loop and the PvP defender's shot adjudication.
export function applyFire(ships: Ship[], r: number, c: number): { ships: Ship[]; result: 'miss' | 'hit' | 'sunk' } {
  let result: 'miss' | 'hit' | 'sunk' = 'miss'
  const next = ships.map((sh) => {
    if (sh.cells.some((x) => x.r === r && x.c === c)) { const hits = sh.hits + 1; result = hits >= sh.size ? 'sunk' : 'hit'; return { ...sh, hits } }
    return sh
  })
  return { ships: next, result }
}

// Fire at a cell already known not to be previously shot. Mutates hit count.
export function resolveFire(ships: Ship[], r: number, c: number): 'miss' | 'hit' | 'sunk' {
  const sh = shipAt(ships, r, c)
  if (!sh) return 'miss'
  sh.hits += 1
  return isSunk(sh) ? 'sunk' : 'hit'
}

// AI random guess among cells not yet fired at.
export function aiPick(shot: Set<string>): Cell {
  const open: Cell[] = []
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!shot.has(keyOf(r, c))) open.push({ r, c })
  return open[Math.floor(Math.random() * open.length)]
}
