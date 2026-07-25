// Ascend's board face — a deterministic, vintage snakes-and-ladders painting:
// a 10×10 patchwork of muted earth-tone tiles with serif numerals, "100 FINISH"
// at the summit, and an ornate carved-wood double border. Pure layout math
// (rects, palette picks, hashing) lives beside one canvas painter; the 3D
// component owns creating the canvas/texture. Snakes and ladders are NOT baked
// in here — they're live 3D objects placed at the real chute positions.

import { BOARD_N, LAST_SQUARE, squareToCell } from './ascend'

export const TILE_PX = 110
export const FRAME_PX = 100
export const GRID_PX = TILE_PX * BOARD_N
export const BOARD_PX = GRID_PX + FRAME_PX * 2
/** Frame band as a fraction of the full face width, per edge. A user-supplied
 *  board image should keep roughly this margin so tiles line up with pieces. */
export const FRAME_FRACTION = FRAME_PX / BOARD_PX

/** Deterministic hash → [0, 1). Same square + salt always paints the same. */
export function hash01(n: number, salt = 0): number {
  let x = Math.imul(n + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x165667b1, 0xc2b2ae35)
  x ^= x >>> 13
  x = Math.imul(x, 0x27d4eb2f)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** The vintage patchwork palette: tile fill + the numeral ink that reads on it. */
export const TILE_PALETTE: readonly { fill: string; ink: string }[] = [
  { fill: '#dcc9a3', ink: '#4a3521' }, // cream
  { fill: '#e6d6b4', ink: '#4a3521' }, // pale parchment
  { fill: '#ad4f31', ink: '#ecd9ae' }, // terracotta
  { fill: '#9c3f2e', ink: '#ecd9ae' }, // rust red
  { fill: '#5d6b3c', ink: '#e8dcb2' }, // olive green
  { fill: '#46647a', ink: '#e5d9b0' }, // slate blue
  { fill: '#c08c3a', ink: '#402c14' }, // ochre gold
]

/** Which palette entry a square wears — cream-weighted patchwork, stable. */
export function tileColorIndex(sq: number): number {
  const r = hash01(sq, 3)
  if (r < 0.26) return 0
  if (r < 0.42) return 1
  if (r < 0.55) return 2
  if (r < 0.65) return 3
  if (r < 0.79) return 4
  if (r < 0.91) return 5
  return 6
}

export interface CanvasRect { x: number; y: number; w: number; h: number }

/** A square's pixel rect on the face canvas. Canvas top row is squares 91–100
 *  (100 top-left, like the classic board); bottom row is 1–10 — this matches
 *  `squareToWorld` when the texture is laid flat with default (flipY) UVs. */
export function squareToCanvasRect(sq: number): CanvasRect {
  const { row, col } = squareToCell(sq)
  return {
    x: FRAME_PX + col * TILE_PX,
    y: FRAME_PX + (BOARD_N - 1 - row) * TILE_PX,
    w: TILE_PX,
    h: TILE_PX,
  }
}

// ---- the painter -------------------------------------------------------------

function paintFrame(ctx: CanvasRenderingContext2D): void {
  const S = BOARD_PX
  const wood = ctx.createLinearGradient(0, 0, S, S)
  wood.addColorStop(0, '#4a2c16')
  wood.addColorStop(0.5, '#2f1b0c')
  wood.addColorStop(1, '#452a15')
  ctx.fillStyle = wood
  ctx.fillRect(0, 0, S, S)

  // carved double border: gold pinstripes at the outer edge and grid edge
  ctx.strokeStyle = 'rgba(214, 172, 96, 0.85)'
  ctx.lineWidth = 3
  ctx.strokeRect(14, 14, S - 28, S - 28)
  ctx.strokeRect(FRAME_PX - 18, FRAME_PX - 18, GRID_PX + 36, GRID_PX + 36)
  ctx.strokeStyle = 'rgba(214, 172, 96, 0.5)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(24, 24, S - 48, S - 48)
  ctx.strokeRect(FRAME_PX - 8, FRAME_PX - 8, GRID_PX + 16, GRID_PX + 16)
  // soft outer-edge highlight, like light catching a bevel
  ctx.strokeStyle = 'rgba(255, 224, 170, 0.16)'
  ctx.lineWidth = 4
  ctx.strokeRect(4, 4, S - 8, S - 8)

  // filigree curls in each corner + a small crest top-centre
  const corners: readonly [number, number, number, number][] = [
    [30, 30, 1, 1], [S - 30, 30, -1, 1], [30, S - 30, 1, -1], [S - 30, S - 30, -1, -1],
  ]
  ctx.strokeStyle = 'rgba(214, 172, 96, 0.75)'
  ctx.lineWidth = 2.5
  for (const [cx, cy, sx, sy] of corners) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(sx, sy)
    ctx.beginPath()
    ctx.moveTo(2, 52)
    ctx.quadraticCurveTo(4, 8, 52, 2)
    ctx.moveTo(34, 10)
    ctx.arc(24, 18, 12, -0.6, 2.2)
    ctx.moveTo(12, 32)
    ctx.quadraticCurveTo(26, 30, 32, 44)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(15, 15, 3.2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(214, 172, 96, 0.8)'
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  ctx.translate(S / 2, 44)
  ctx.beginPath()
  ctx.moveTo(0, -12)
  ctx.lineTo(9, 0)
  ctx.lineTo(0, 12)
  ctx.lineTo(-9, 0)
  ctx.closePath()
  ctx.fillStyle = 'rgba(214, 172, 96, 0.8)'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-64, 0)
  ctx.quadraticCurveTo(-34, -10, -14, 0)
  ctx.moveTo(64, 0)
  ctx.quadraticCurveTo(34, -10, 14, 0)
  ctx.stroke()
  ctx.restore()
}

function paintTile(ctx: CanvasRenderingContext2D, sq: number): void {
  const { x, y, w, h } = squareToCanvasRect(sq)
  const { fill } = TILE_PALETTE[tileColorIndex(sq)]
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  // aged edges: a darker inner seam and a whisper of top light
  ctx.strokeStyle = 'rgba(42, 26, 12, 0.30)'
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  ctx.fillStyle = 'rgba(255, 246, 224, 0.10)'
  ctx.fillRect(x + 2, y + 2, w - 4, 3)
  // three faint blotches so no two tiles age alike
  for (let k = 0; k < 3; k++) {
    const bx = x + (0.15 + 0.7 * hash01(sq, 20 + k)) * w
    const by = y + (0.15 + 0.7 * hash01(sq, 40 + k)) * h
    const br = (0.1 + 0.16 * hash01(sq, 60 + k)) * w
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(46, 28, 12, 0.05)'
    ctx.fill()
  }
}

function paintNumeral(ctx: CanvasRenderingContext2D, sq: number): void {
  const { x, y, w, h } = squareToCanvasRect(sq)
  const { ink } = TILE_PALETTE[tileColorIndex(sq)]
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (sq === LAST_SQUARE) {
    ctx.font = `${Math.round(TILE_PX * 0.32)}px Georgia, 'Times New Roman', serif`
    ctx.fillText('100', cx, cy - h * 0.17)
    ctx.font = `${Math.round(TILE_PX * 0.14)}px Georgia, 'Times New Roman', serif`
    ctx.fillText('FINISH', cx, cy + h * 0.13)
    ctx.fillRect(cx - w * 0.22, cy + h * 0.26, w * 0.44, 2)
    return
  }
  ctx.font = `${Math.round(TILE_PX * 0.42)}px Georgia, 'Times New Roman', serif`
  ctx.fillText(String(sq), cx, cy + 2)
}

/** Paint the whole vintage face onto a BOARD_PX × BOARD_PX canvas context.
 *  Deterministic — same pixels every run. */
export function paintAscendBoardFace(ctx: CanvasRenderingContext2D): void {
  paintFrame(ctx)
  for (let sq = 1; sq <= LAST_SQUARE; sq++) paintTile(ctx, sq)
  for (let sq = 1; sq <= LAST_SQUARE; sq++) paintNumeral(ctx, sq)
  // overall paper grain — tiny warm/dark specks across the entire face
  for (let i = 0; i < 2400; i++) {
    const gx = hash01(i, 101) * BOARD_PX
    const gy = hash01(i, 102) * BOARD_PX
    ctx.fillStyle = i % 2 === 0 ? 'rgba(52, 32, 14, 0.05)' : 'rgba(255, 240, 208, 0.04)'
    ctx.fillRect(gx, gy, 2, 2)
  }
}
