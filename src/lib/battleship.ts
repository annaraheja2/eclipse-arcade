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
export const isSunk = (sh: Ship) => sh.hits >= sh.size
export const allSunk = (ships: Ship[]) => ships.every(isSunk)

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
