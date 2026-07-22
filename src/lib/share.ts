import { ROUND_MAX } from './games'

// Wordle-style spoiler-free result card: one colored square per round, keyed off
// the same score thresholds the Results screen uses (green ≥780, accent ≥400, else
// orange). Pure — returns shareable text only; effects (share sheet / clipboard)
// live at the call site. Squares are Unicode content, not web UI, so they're fine.
function squareFor(pts: number): string {
  if (pts >= 780) return '🟩'
  if (pts >= 400) return '🟦'
  return '🟧'
}

export function buildShareCard(gameName: string, pts: number[], total: number, level: number): string {
  const squares = pts.map(squareFor).join('')
  const max = pts.length * ROUND_MAX
  return `Eclipse Arcade — ${gameName}\n${squares}\n${total}/${max} · LVL ${level}`
}
