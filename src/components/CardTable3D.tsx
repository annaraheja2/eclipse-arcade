// The 3D card table — the real-3D presentation layer that replaced the 2D
// CardTable in the same slot. It consumes the SAME view model from useCardGame
// and routes every interaction through the same callbacks; no rules live here.
//
// Scene: a felt-topped wooden table on an open-air deck at golden hour — a low
// sun on the horizon, a hand-tuned sunset gradient dome, silhouetted hills and
// a lake catching the sun's streak, warm fog for depth. The sun is the key
// light (long soft shadows across the table); a dusk hemisphere + a soft
// camera-side fill keep the card faces readable. The camera is the storyteller:
// on your turn it closes in on your hand; on an opponent's turn your hand
// minimizes and the camera pulls back and turns toward the active player.
//
// Accessibility: the canvas is decorative-labelled; the ACTUAL interactive hand
// is a visually-hidden (focusable) DOM button list kept in lockstep with the 3D
// fan — keyboard focus highlights the matching 3D card and a caption names it.
// Card faces always carry glyph + color NAME (never hue alone).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, CanvasTexture,
  CatmullRomCurve3, Color as ThreeColor, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three'
import type { Group, InstancedMesh, Mesh } from 'three'
import { SunsetWorld, SunsetLights, SUNSET_FOG, HAZE, mulberry32 } from './SunsetWorld'
import Character3D, { SEAT_TINTS } from './Character3D'
import type { Card, Color } from '../lib/cardgame'
import { colorName, describeCard } from '../lib/cardgameView'
import type { CardGameView, CardPhase } from '../hooks/useCardGame'

// ---- the ECLIPSE deck --------------------------------------------------------
// The user's own deck design: elegant celestial art-deco. Four suits replace
// the UNO hues — SOLAR (cream), LUNAR (navy), FOREST (emerald), EMBER
// (crimson) — while the engine's Color keys stay untouched (presentation-only
// remap, mirrored in CardFace.tsx and the CardGame page).
type Suit = {
  stock0: string; stock1: string // card-stock gradient, top → bottom
  ink: string //   numerals / symbols / the color name (AA on the stock)
  gold: string //  border + celestial linework
  motif: number // linework alpha — the motif stays behind the numeral
  swatch: string // UI indicator hex: discard halo, color sign, pick buttons
  swatchInk: string // text on the swatch (the cream suit takes dark ink)
}
const SUIT: Record<Color, Suit> = {
  yellow: { stock0: '#f0e4c6', stock1: '#ddcaa0', ink: '#26190e', gold: '#96742f', motif: 0.4, swatch: '#e9dcba', swatchInk: '#26190e' },
  blue: { stock0: '#243550', stock1: '#152238', ink: '#f0e4c4', gold: '#c9a35c', motif: 0.5, swatch: '#3c5c94', swatchInk: '#ffffff' },
  green: { stock0: '#465c3c', stock1: '#31452b', ink: '#f0e6c8', gold: '#c9a35c', motif: 0.5, swatch: '#4e7a48', swatchInk: '#ffffff' },
  red: { stock0: '#96352a', stock1: '#75251d', ink: '#f2e4c4', gold: '#dcb46a', motif: 0.5, swatch: '#b8412f', swatchInk: '#ffffff' },
}
// Wilds are suitless: near-black night stock, the full gold treatment.
const WILD_SUIT: Suit = { stock0: '#1e1930', stock1: '#110d1f', ink: '#f0e4c4', gold: '#c9a35c', motif: 0.5, swatch: '#c9a35c', swatchInk: '#26190e' }
// The wild diamond's four quadrants, N/E/S/W: solar, lunar, ember, forest.
const QUAD_COLORS = ['#e9dcba', '#3c5c94', '#b8412f', '#4e7a48'] as const
// ---- golden-hour palette -----------------------------------------------------
const DUSK_DIM = '#3a2f45' // dimmed characters/cards sink toward dusk, not void
const FELT = '#2e6647' // classic deep-green card felt, warmed by the sun
const WOOD_RIM = '#7a5230'
const WOOD_SKIRT = '#5d3f26'
const WOOD_DARK = '#46301c'
const DECK_TOP_Y = -1.35 // the wooden deck surface the table stands on

// ---- world layout (units: 1 card is 1 x 1.5) --------------------------------
const TABLE_R = 3.6
const SEAT_R = 4.55
const CARD_W = 1
const CARD_H = 1.5

/** Seat i (of n players) around the table; you (i=0) sit at +z facing the
 *  camera. Opponent seats are squeezed toward the BACK arc so nobody parks at
 *  the camera's frustum edge — the whole field reads in one glance. */
const SEAT_SQUEEZE = 0.72
function seatPosition(i: number, n: number): { x: number; z: number } {
  const even = Math.PI / 2 + (2 * Math.PI * i) / n
  const back = (3 * Math.PI) / 2
  const angle = i === 0 ? even : back + (even - back) * SEAT_SQUEEZE
  return { x: Math.cos(angle) * SEAT_R, z: Math.sin(angle) * SEAT_R }
}

// ---- canvas textures ---------------------------------------------------------
// All card faces / labels are drawn once to canvases and mapped onto planes —
// crisp at any dpr, zero per-frame cost. Faces are cached per unique face (54
// max) with their materials, and disposed when the table unmounts.

const FACE_W = 320
const FACE_H = 480
// Clean geometric sans for UI labels drawn to canvas — no pixel glyphs.
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
// The ECLIPSE deck's numerals are an elegant high-contrast serif — a deliberate
// divergence for this cabinet. Loaded in index.html; textures bake after
// document.fonts resolves so the canvas never rasterizes the fallback.
const SERIF_FAMILY = '"Playfair Display"'
const SERIF = `${SERIF_FAMILY}, Georgia, "Times New Roman", serif`

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function makeTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---- ECLIPSE face painting ---------------------------------------------------
// Every face shares the same anatomy as the reference deck: suit card stock,
// an ornate double gold border with corner accents, a subtle celestial motif
// (eclipse circle + sunburst, an orbit line, scattered stars) behind a large
// high-contrast serif glyph, corner indices top-left/bottom-right, and the
// color NAME bottom-left (fans overlap from the right — the left strip survives).

const FACE_CX = FACE_W / 2
const FACE_CY = 222 // the eclipse circle's centre — above the name strip
const ECLIPSE_R = 104

/** A 4-point sparkle (two pinched diamonds) — the deck's star mark. */
function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y)
  ctx.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r)
  ctx.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y)
  ctx.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r)
  ctx.closePath()
  ctx.fill()
}

/** Card stock + ornate gold frame + the celestial linework, shared by all faces. */
function drawEclipseBase(ctx: CanvasRenderingContext2D, suit: Suit) {
  // stock — darkens gently toward the foot, like aged paper
  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 28)
  const body = ctx.createLinearGradient(0, 0, 0, FACE_H)
  body.addColorStop(0, suit.stock0)
  body.addColorStop(1, suit.stock1)
  ctx.fillStyle = body
  ctx.fill()
  // dark outer edge so stacked/fanned cards separate
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(12,8,4,0.5)'
  roundedRect(ctx, 1.5, 1.5, FACE_W - 3, FACE_H - 3, 26)
  ctx.stroke()

  // double gold border, the fine inner line ghosted
  ctx.strokeStyle = suit.gold
  ctx.lineWidth = 3
  roundedRect(ctx, 12, 12, FACE_W - 24, FACE_H - 24, 20)
  ctx.stroke()
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.4
  roundedRect(ctx, 19, 19, FACE_W - 38, FACE_H - 38, 14)
  ctx.stroke()
  ctx.restore()
  // corner flourish diamonds on the corners the indices don't occupy
  ctx.fillStyle = suit.gold
  drawSparkle(ctx, FACE_W - 34, 34, 9)
  drawSparkle(ctx, 34, FACE_H - 34, 9)

  // celestial motif, clipped inside the fine border so nothing kisses the edge
  ctx.save()
  roundedRect(ctx, 21, 21, FACE_W - 42, FACE_H - 42, 13)
  ctx.clip()
  ctx.strokeStyle = suit.gold
  ctx.fillStyle = suit.gold
  // orbit line sweeping across the card behind the eclipse
  ctx.globalAlpha = suit.motif * 0.55
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.ellipse(FACE_CX, FACE_CY + 10, 215, 82, -0.42, 0, Math.PI * 2)
  ctx.stroke()
  // the eclipse circle
  ctx.globalAlpha = suit.motif
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.arc(FACE_CX, FACE_CY, ECLIPSE_R, 0, Math.PI * 2)
  ctx.stroke()
  // fine sunburst rays radiating off it, alternating lengths
  ctx.globalAlpha = suit.motif * 0.75
  ctx.lineWidth = 1.1
  ctx.beginPath()
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    const r0 = ECLIPSE_R + 5
    const r1 = r0 + (i % 3 === 0 ? 16 : i % 3 === 1 ? 8 : 12)
    ctx.moveTo(FACE_CX + Math.cos(a) * r0, FACE_CY + Math.sin(a) * r0)
    ctx.lineTo(FACE_CX + Math.cos(a) * r1, FACE_CY + Math.sin(a) * r1)
  }
  ctx.stroke()
  // scattered stars — sparse, asymmetric, like the reference
  ctx.globalAlpha = suit.motif * 0.9
  drawSparkle(ctx, 52, 74, 6)
  drawSparkle(ctx, 268, 96, 4.5)
  drawSparkle(ctx, 42, 250, 3.5)
  drawSparkle(ctx, 280, 320, 4)
  drawSparkle(ctx, 74, 396, 4.5)
  drawSparkle(ctx, 252, 408, 5.5)
  ctx.restore()
}

/** The color-name strip, bottom-left in suit ink — the non-color signal (AA
 *  against the stock, no pill: the deck's own typography carries it). */
function drawFaceName(ctx: CanvasRenderingContext2D, label: string, suit: Suit) {
  ctx.save()
  ctx.font = `600 23px ${SANS}`
  ctx.letterSpacing = '4px'
  ctx.fillStyle = suit.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label, 30, FACE_H - 32)
  ctx.restore()
}

/** Serif corner indices: top-left, and bottom-right rotated 180°. */
function drawCornerIndices(ctx: CanvasRenderingContext2D, glyph: string, suit: Suit) {
  ctx.fillStyle = suit.ink
  ctx.font = `600 50px ${SERIF}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(glyph, 30, 26)
  ctx.save()
  ctx.translate(FACE_W - 30, FACE_H - 26)
  ctx.rotate(Math.PI)
  ctx.fillText(glyph, 0, 0)
  ctx.restore()
}

function drawFace(ctx: CanvasRenderingContext2D, card: Card) {
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  const suit = card.color ? SUIT[card.color] : WILD_SUIT
  drawEclipseBase(ctx, suit)

  if (isWild) {
    // the suit diamond: a rhombus quartered into the four ECLIPSE colors
    const hw = 78
    const hh = 96
    const cx = FACE_CX
    const cy = FACE_CY
    const pts: readonly (readonly [number, number])[] = [
      [cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy],
    ]
    QUAD_COLORS.forEach((c, i) => {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(pts[i][0], pts[i][1])
      ctx.lineTo(pts[(i + 1) % 4][0], pts[(i + 1) % 4][1])
      ctx.closePath()
      ctx.fillStyle = c
      ctx.fill()
    })
    // gold rhombus outline + diagonals
    ctx.strokeStyle = suit.gold
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[2][0], pts[2][1])
    ctx.moveTo(pts[3][0], pts[3][1]); ctx.lineTo(pts[1][0], pts[1][1])
    ctx.stroke()
    if (card.kind === 'wild4') drawCornerIndices(ctx, '+4', suit)
  } else if (card.kind === 'number') {
    const glyph = String(card.value)
    ctx.fillStyle = suit.ink
    ctx.font = `600 196px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, FACE_CX, FACE_CY + 12)
    drawCornerIndices(ctx, glyph, suit)
  } else if (card.kind === 'draw2') {
    ctx.fillStyle = suit.ink
    ctx.font = `600 110px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+2', FACE_CX, FACE_CY + 8)
    drawCornerIndices(ctx, '+2', suit)
  } else {
    // skip / reverse — drawn vector symbols, centre + corner minis
    drawTurnSymbol(ctx, card.kind, FACE_CX, FACE_CY, 62, suit.ink)
    drawTurnSymbol(ctx, card.kind, 52, 52, 22, suit.ink)
    ctx.save()
    ctx.translate(FACE_W - 52, FACE_H - 52)
    ctx.rotate(Math.PI)
    drawTurnSymbol(ctx, card.kind, 0, 0, 22, suit.ink)
    ctx.restore()
  }

  const label = isWild ? (card.kind === 'wild4' ? 'WILD +4' : 'WILD') : colorName(card.color!).toUpperCase()
  drawFaceName(ctx, label, suit)
}

/** Skip (a slashed circle) and Reverse (two chasing arc arrows) — pure vector,
 *  no emoji glyphs, so they stay crisp and identical across platforms. */
function drawTurnSymbol(ctx: CanvasRenderingContext2D, kind: 'skip' | 'reverse', x: number, y: number, r: number, ink: string) {
  ctx.save()
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineCap = 'round'
  if (kind === 'skip') {
    ctx.lineWidth = r * 0.22
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    const d = r * Math.SQRT1_2
    ctx.beginPath()
    ctx.moveTo(x - d, y + d)
    ctx.lineTo(x + d, y - d)
    ctx.stroke()
  } else {
    // two arcs in circular flow, each ending in a solid arrowhead
    ctx.lineWidth = r * 0.2
    const head = r * 0.42
    for (const start of [-0.35, Math.PI - 0.35]) {
      const end = start + Math.PI * 0.72
      ctx.beginPath()
      ctx.arc(x, y, r * 0.82, start, end)
      ctx.stroke()
      // arrowhead tangent to the arc at its end
      const hx = x + Math.cos(end) * r * 0.82
      const hy = y + Math.sin(end) * r * 0.82
      const t = end + Math.PI / 2 // direction of travel
      ctx.beginPath()
      ctx.moveTo(hx + Math.cos(t) * head, hy + Math.sin(t) * head)
      ctx.lineTo(hx + Math.cos(end) * head * 0.62, hy + Math.sin(end) * head * 0.62)
      ctx.lineTo(hx - Math.cos(end) * head * 0.62, hy - Math.sin(end) * head * 0.62)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

// The card back: the ECLIPSE brand — deep navy, a large gold crescent inside
// a fine sunburst, scattered stars, and the same ornate gold border.
function drawBack(ctx: CanvasRenderingContext2D) {
  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 28)
  const g = ctx.createLinearGradient(0, 0, 0, FACE_H)
  g.addColorStop(0, '#182338')
  g.addColorStop(1, '#0d1424')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(8,6,2,0.6)'
  roundedRect(ctx, 1.5, 1.5, FACE_W - 3, FACE_H - 3, 26)
  ctx.stroke()

  const gold = '#c9a35c'
  ctx.strokeStyle = gold
  ctx.fillStyle = gold
  ctx.lineWidth = 3
  roundedRect(ctx, 12, 12, FACE_W - 24, FACE_H - 24, 20)
  ctx.stroke()
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.4
  roundedRect(ctx, 19, 19, FACE_W - 38, FACE_H - 38, 14)
  ctx.stroke()
  ctx.restore()
  drawSparkle(ctx, 34, 34, 9)
  drawSparkle(ctx, FACE_W - 34, 34, 9)
  drawSparkle(ctx, 34, FACE_H - 34, 9)
  drawSparkle(ctx, FACE_W - 34, FACE_H - 34, 9)

  const cx = FACE_W / 2
  const cy = FACE_H / 2
  // fine sunburst around the moon
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const r0 = 104
    const r1 = r0 + (i % 2 === 0 ? 22 : 11)
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
  }
  ctx.stroke()
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(cx, cy, 96, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  // the crescent: gold disc, night disc offset to carve the sliver
  ctx.beginPath()
  ctx.arc(cx, cy, 74, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + 30, cy - 20, 68, 0, Math.PI * 2)
  ctx.fillStyle = '#111a2c'
  ctx.fill()
  // stars in the field
  ctx.fillStyle = gold
  ctx.save()
  ctx.globalAlpha = 0.85
  drawSparkle(ctx, 74, 92, 7)
  drawSparkle(ctx, 250, 76, 5)
  drawSparkle(ctx, 262, 200, 4)
  drawSparkle(ctx, 58, 356, 5)
  drawSparkle(ctx, 240, 396, 7)
  drawSparkle(ctx, 160, 428, 4)
  ctx.restore()
}

const faceKey = (card: Card) => (card.kind === 'number' ? `n${card.color}${card.value}` : `${card.kind}${card.color ?? ''}`)

/** Per-mount cache of face/back textures + their materials. PBR with a
 *  self-lit floor: the emissive map keeps every face readable while the
 *  standard shading lets the card stock catch the golden light. */
class CardSkins {
  private mats = new Map<string, MeshStandardMaterial>()
  private textures: CanvasTexture[] = []

  private material(key: string, draw: (ctx: CanvasRenderingContext2D) => void): MeshStandardMaterial {
    const hit = this.mats.get(key)
    if (hit) return hit
    const tex = makeTexture(FACE_W, FACE_H, draw)
    this.textures.push(tex)
    const mat = new MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: new ThreeColor('#5c5c5c'),
      roughness: 0.55, alphaTest: 0.5,
    })
    this.mats.set(key, mat)
    return mat
  }

  face(card: Card): MeshStandardMaterial {
    return this.material(faceKey(card), (ctx) => drawFace(ctx, card))
  }

  back(): MeshStandardMaterial {
    return this.material('back', drawBack)
  }

  dispose() {
    for (const m of this.mats.values()) m.dispose()
    for (const t of this.textures) t.dispose()
    this.mats.clear()
    this.textures.length = 0
  }
}

/** A one-off text texture (seat labels, the color sign) with its material. */
function useLabelMaterial(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number, key: string): MeshBasicMaterial {
  const mat = useMemo(() => {
    const tex = makeTexture(w, h, draw)
    return new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
    // `key` encodes everything the drawing reads — redraw only when it changes.
  }, [key, w, h]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { mat.map?.dispose(); mat.dispose() }, [mat])
  return mat
}

// ---- opponent seat -------------------------------------------------------------

const FAN_MAX = 10 // fan display cap; the label always carries the true count

function OpponentSeat({ seat, index, total, skins, cardGeo, accent, reduced }: {
  seat: { name: string; count: number; current: boolean }
  index: number // 1-based seat index around the table
  total: number
  skins: CardSkins
  cardGeo: PlaneGeometry
  accent: string
  reduced: boolean
}) {
  const puckRef = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const puck = puckRef.current
    if (!puck || reduced) return
    const s = 1 + Math.sin(clock.elapsedTime * 2.6) * 0.08
    puck.scale.setScalar(s)
  })
  const { x, z } = seatPosition(index, total)
  const yaw = Math.atan2(-x, -z) // local +z points at the table centre
  const shown = Math.min(seat.count, FAN_MAX)
  const labelKey = `${seat.name}|${seat.count}|${seat.current}`
  const labelMat = useLabelMaterial((ctx) => {
    ctx.font = `600 44px ${SANS}`
    const text = `${seat.name} · ${seat.count}`
    const tw = ctx.measureText(text).width
    roundedRect(ctx, 256 - tw / 2 - 26, 24, tw + 52, 80, 22)
    ctx.fillStyle = 'rgba(24,16,14,0.78)'
    ctx.fill()
    if (seat.current) {
      ctx.lineWidth = 6
      ctx.strokeStyle = accent
      roundedRect(ctx, 256 - tw / 2 - 26, 24, tw + 52, 80, 22)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 66)
  }, 512, 128, labelKey)

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* stool grounding the character on the deck */}
      <mesh position={[0, (DECK_TOP_Y + 0.45) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.48, 0.45 - DECK_TOP_Y, 12]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
      </mesh>
      <group scale={1.15}>
        <Character3D tint={SEAT_TINTS[index % SEAT_TINTS.length]} dimmed={!seat.current} dimColor={DUSK_DIM} />
      </group>
      {/* face-down fan on the table edge — counter-yawed so it always faces
          the camera side instead of reading edge-on from side seats */}
      <group position={[0, 0.32, 1.5]} rotation={[0, -yaw, 0]}>
        <group rotation={[-0.5, 0, 0]}>
          {Array.from({ length: shown }, (_, i) => {
            const spread = Math.min(0.3, 1.8 / Math.max(1, shown))
            const k = i - (shown - 1) / 2
            return (
              <mesh
                key={i}
                geometry={cardGeo}
                material={skins.back()}
                position={[k * spread, Math.abs(k) * -0.02, i * 0.006]}
                rotation={[0, 0, k * -0.08]}
                scale={0.5}
              />
            )
          })}
        </group>
      </group>
      {/* name · count above the head — counter-yawed upright toward the camera */}
      <mesh position={[0, 2.95, 0]} rotation={[0, -yaw, 0]}>
        <planeGeometry args={[2.6, 0.65]} />
        <primitive object={labelMat} attach="material" />
      </mesh>
      {/* active-turn glow puck + a spot of light on whoever holds the floor */}
      {seat.current && (
        <>
          <mesh ref={puckRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.95, 24]} />
            <meshBasicMaterial color={accent} transparent opacity={0.35} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 3.2, 0.6]} intensity={10} color="#ffe3c0" distance={6} decay={2} />
        </>
      )}
    </group>
  )
}

// ---- centre of the table --------------------------------------------------------

function TableCentre({ view, skins, cardGeo, reduced }: {
  view: CardGameView
  skins: CardSkins
  cardGeo: PlaneGeometry
  reduced: boolean
}) {
  const { top, currentColor } = view
  const direction = view.state?.direction ?? 1
  const arrowRef = useRef<Mesh>(null)

  const arrowMat = useLabelMaterial((ctx) => {
    // two opposing arc arrows — the turn-direction dial
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 14
    ctx.lineCap = 'round'
    for (const [a0, a1] of [[-0.4, 1.2], [Math.PI - 0.4, Math.PI + 1.2]] as const) {
      ctx.beginPath()
      ctx.arc(128, 128, 96, a0, a1)
      ctx.stroke()
      const tip = a1 + 0.16
      const tx = 128 + Math.cos(tip) * 96
      const ty = 128 + Math.sin(tip) * 96
      const tangent = tip + Math.PI / 2
      ctx.beginPath()
      ctx.moveTo(tx + Math.cos(tangent) * 22, ty + Math.sin(tangent) * 22)
      ctx.lineTo(tx + Math.cos(tip) * -26 + Math.cos(tangent) * -4, ty + Math.sin(tip) * -26 + Math.sin(tangent) * -4)
      ctx.lineTo(tx + Math.cos(tip) * 26 + Math.cos(tangent) * -4, ty + Math.sin(tip) * 26 + Math.sin(tangent) * -4)
      ctx.closePath()
      ctx.fill()
    }
  }, 256, 256, 'arrows')

  useFrame((_, dt) => {
    if (reduced || !arrowRef.current) return
    arrowRef.current.rotation.z += direction * 0.5 * dt
  })

  const colorHex = currentColor ? SUIT[currentColor].swatch : '#ffffff'
  const signMat = useLabelMaterial((ctx) => {
    if (!currentColor) return
    ctx.font = `700 50px ${SANS}`
    const text = colorName(currentColor).toUpperCase()
    const tw = ctx.measureText(text).width
    const w = tw + 150
    roundedRect(ctx, 256 - w / 2, 20, w, 88, 24)
    ctx.fillStyle = 'rgba(24,16,14,0.82)'
    ctx.fill()
    roundedRect(ctx, 256 - w / 2 + 22, 42, 44, 44, 8)
    ctx.fillStyle = SUIT[currentColor].swatch
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256 - w / 2 + 86, 66)
  }, 512, 128, `sign|${currentColor ?? 'none'}`)

  return (
    <group>
      {/* direction dial flat on the felt */}
      <mesh ref={arrowRef} position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={direction === -1 ? [-1.4, 1.4, 1.4] : 1.4}>
        <planeGeometry args={[1, 1]} />
        <primitive object={arrowMat} attach="material" />
      </mesh>
      {/* draw pile — a short stack of backs */}
      <group position={[1.2, 0, -0.9]} rotation={[0, -0.25, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={cardGeo} material={skins.back()} position={[0, 0.06 + i * 0.015, 0]} rotation={[-Math.PI / 2, 0, 0.06 * i]} scale={0.85} />
        ))}
      </group>
      {/* discard — the top card, tilted slightly toward your seat for legibility */}
      {top && (
        <group position={[-1.0, 0, -0.9]} rotation={[0, 0.22, 0]}>
          <mesh geometry={cardGeo} material={skins.back()} position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, -0.15]} scale={0.85} />
          <mesh geometry={cardGeo} material={skins.face(top)} position={[0, 0.1, 0.06]} rotation={[-Math.PI / 2 + 0.28, 0, 0.05]} scale={0.95} />
          {/* active color halo around the discard */}
          {currentColor && (
            <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.78, 0.94, 36]} />
              <meshBasicMaterial color={colorHex} transparent opacity={0.8} toneMapped={false} />
            </mesh>
          )}
        </group>
      )}
      {/* standing color sign behind the piles, facing your seat */}
      {currentColor && (
        <mesh position={[0.1, 1.0, -2.1]} rotation={[-0.12, 0, 0]}>
          <planeGeometry args={[2.5, 0.62]} />
          <primitive object={signMat} attach="material" />
        </mesh>
      )}
    </group>
  )
}

// ---- your hand --------------------------------------------------------------------
// A fan of full-size cards facing the camera. Legal cards lift on an accent
// glow; the keyboard-focused card carries a white ring (DOM focus and the 3D
// fan stay in lockstep). All picking is r3f raycasting onto the card planes.

const HAND_POS: readonly [number, number, number] = [0, 0.82, 2.95]
const HAND_TILT = -0.48 // lean the fan back toward the raised camera

function Hand({ view, skins, cardGeo, accent, focusedId, onActivate, groupRef }: {
  view: CardGameView
  skins: CardSkins
  cardGeo: PlaneGeometry
  accent: string
  focusedId: string | null
  onActivate: (card: Card) => void
  groupRef: React.RefObject<Group>
}) {
  const { hand, legal, stackable, phase } = view
  const actionable = phase === 'choose' ? legal : phase === 'penalty' ? stackable : []
  const actionableIds = useMemo(() => new Set(actionable.map((c) => c.id)), [actionable])
  const interactive = phase === 'choose' || phase === 'penalty'
  const [hoverId, setHoverId] = useState<string | null>(null)
  const gl = useThree((s) => s.gl)

  // A vanished card (played) must not keep a stale hover/cursor.
  useEffect(() => {
    if (hoverId && !hand.some((c) => c.id === hoverId)) setHoverId(null)
  }, [hand, hoverId])
  useEffect(() => {
    gl.domElement.style.cursor = hoverId && actionableIds.has(hoverId) && interactive ? 'pointer' : 'auto'
    return () => { gl.domElement.style.cursor = 'auto' }
  }, [gl, hoverId, actionableIds, interactive])

  const n = hand.length
  const spacing = Math.min(0.62, 5.4 / Math.max(1, n))

  return (
    <group ref={groupRef} position={[HAND_POS[0], HAND_POS[1], HAND_POS[2]]} rotation={[HAND_TILT, 0, 0]}>
      {hand.map((card, i) => {
        const k = i - (n - 1) / 2
        const active = actionableIds.has(card.id)
        const dim = interactive && !active
        const raised = active && (hoverId === card.id || focusedId === card.id)
        const lift = (active ? 0.22 : 0) + (raised ? 0.16 : 0)
        return (
          <group
            key={card.id}
            position={[k * spacing, -Math.abs(k) * spacing * 0.13 + lift, i * 0.012]}
            rotation={[0, 0, k * -0.05]}
          >
            <mesh
              geometry={cardGeo}
              material={skins.face(card)}
              onClick={(e) => { e.stopPropagation(); if (interactive && active) onActivate(card) }}
              onPointerOver={(e) => { e.stopPropagation(); setHoverId(card.id) }}
              onPointerOut={() => setHoverId((h) => (h === card.id ? null : h))}
            />
            {/* accent glow behind a playable card; white ring when focused */}
            {active && (
              <mesh geometry={cardGeo} position={[0, 0, -0.008]} scale={[1.1, 1.07, 1]}>
                <meshBasicMaterial color={focusedId === card.id ? '#ffffff' : accent} transparent opacity={focusedId === card.id ? 0.95 : 0.75} toneMapped={false} depthWrite={false} />
              </mesh>
            )}
            {/* dim veil over unplayable cards during your decision */}
            {dim && (
              <mesh geometry={cardGeo} position={[0, 0, 0.006]}>
                <meshBasicMaterial color={DUSK_DIM} transparent opacity={0.55} toneMapped={false} depthWrite={false} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ---- string lights ------------------------------------------------------------------
// Three slim poles at the back of the deck carry two sagging strings of warm
// bulbs — cozy foreground framing against the sunset. Purely decorative: basic
// materials, no extra lights, nothing animated.

const LIGHT_POSTS: readonly (readonly [number, number])[] = [[-6.5, -3.4], [0, -7.1], [6.5, -3.4]]
const POST_TOP_Y = 3.55
const BULBS_PER_SPAN = 7

function StringLights() {
  const { wires, bulbs } = useMemo(() => {
    const spanCurves = [0, 1].map((s) => {
      const [ax, az] = LIGHT_POSTS[s]
      const [bx, bz] = LIGHT_POSTS[s + 1]
      return new CatmullRomCurve3([
        new Vector3(ax, POST_TOP_Y, az),
        new Vector3((ax + bx) / 2, POST_TOP_Y - 0.55, (az + bz) / 2),
        new Vector3(bx, POST_TOP_Y, bz),
      ])
    })
    const wires = spanCurves.map((c) => new TubeGeometry(c, 24, 0.018, 4))
    const bulbs = spanCurves.flatMap((c) =>
      Array.from({ length: BULBS_PER_SPAN }, (_, i) => {
        const p = c.getPoint((i + 1) / (BULBS_PER_SPAN + 1))
        return [p.x, p.y - 0.09, p.z] as const
      }))
    return { wires, bulbs }
  }, [])
  useEffect(() => () => { for (const w of wires) w.dispose() }, [wires])
  return (
    <group>
      {LIGHT_POSTS.map(([x, z], i) => (
        <mesh key={i} position={[x, (POST_TOP_Y + DECK_TOP_Y) / 2, z]}>
          <cylinderGeometry args={[0.05, 0.07, POST_TOP_Y - DECK_TOP_Y, 8]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.9} />
        </mesh>
      ))}
      {wires.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshBasicMaterial color="#241a12" />
        </mesh>
      ))}
      {bulbs.map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[0.058, 10, 8]} />
          <meshBasicMaterial color="#ffe2a4" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// ---- background gathering -----------------------------------------------------------
// Ambiance only: more card tables with seated figures scattered across the
// meadow so the sunset reads as a lively outdoor card night. Five instanced
// meshes total (tops, pedestals, bodies, heads, lanterns) — a handful of draw
// calls regardless of crowd size. Layout is baked once from hand-picked
// anchors + a seeded PRNG, keeping the sun / lake-shimmer corridor and the
// player's deck clear. No shadows; the existing fog hazes the far tables.

const MEADOW_Y = DECK_TOP_Y - 0.22
// Anchor spots (x, z) flanking the sun corridor (x ≈ -4…-7 over z -20…-55).
const BG_ANCHORS: readonly (readonly [number, number])[] = [
  [-15, -18], [-22, -27], [-36, -42], [-17, -45],
  [4, -22], [12, -16], [21, -28], [33, -41], [14, -47], [44, -31],
]
// Dusk-muted figure tones — silhouettes catching warm backlight, not team neon.
const BG_TINTS = ['#a06a8a', '#8a6aa0', '#6a7ea0', '#a0836a', '#93705f'] as const
const BG_DUSK = new ThreeColor(DUSK_DIM)
const BG_DUMMY = new Object3D() // matrix scratch — never allocated per frame

type BgFigure = { x: number; z: number; s: number; yaw: number; tint: ThreeColor; phase: number }
type BgTable = { x: number; z: number; r: number; felt: ThreeColor }

function bakeGathering(): { tables: BgTable[]; figures: BgFigure[]; lanterns: (readonly [number, number, number])[] } {
  const rnd = mulberry32(1204)
  const tables: BgTable[] = []
  const figures: BgFigure[] = []
  const lanterns: (readonly [number, number, number])[] = []
  BG_ANCHORS.forEach(([ax, az], ti) => {
    const x = ax + (rnd() - 0.5) * 2
    const z = az + (rnd() - 0.5) * 2
    const dim = Math.min(1, Math.max(0, (-z - 14) / 40)) // 0 near → 1 far
    const r = 1.4 + rnd() * 0.5
    tables.push({ x, z, r, felt: new ThreeColor(FELT).lerp(BG_DUSK, 0.12 + dim * 0.5) })
    const seats = 3 + (rnd() > 0.45 ? 1 : 0)
    const a0 = rnd() * Math.PI * 2
    for (let i = 0; i < seats; i++) {
      const a = a0 + (i / seats) * Math.PI * 2 + (rnd() - 0.5) * 0.6
      const fx = x + Math.cos(a) * (r + 0.55)
      const fz = z + Math.sin(a) * (r + 0.55)
      const s = 0.78 + rnd() * 0.24
      const tint = new ThreeColor(BG_TINTS[(ti + i) % BG_TINTS.length]).lerp(BG_DUSK, 0.3 + dim * 0.45)
      figures.push({ x: fx, z: fz, s, yaw: Math.atan2(x - fx, z - fz), tint, phase: rnd() * Math.PI * 2 })
    }
    if (ti % 2 === 0) lanterns.push([x + (rnd() - 0.5) * 0.6, MEADOW_Y + 1.32, z + (rnd() - 0.5) * 0.6] as const)
  })
  return { tables, figures, lanterns }
}

function BackgroundGathering({ reduced }: { reduced: boolean }) {
  const topRef = useRef<InstancedMesh>(null)
  const baseRef = useRef<InstancedMesh>(null)
  const bodyRef = useRef<InstancedMesh>(null)
  const headRef = useRef<InstancedMesh>(null)
  const layout = useMemo(bakeGathering, [])

  // Bake every instance matrix/tint once — static except the head idle below.
  useEffect(() => {
    const top = topRef.current
    const base = baseRef.current
    const body = bodyRef.current
    const head = headRef.current
    if (!top || !base || !body || !head) return
    layout.tables.forEach((t, i) => {
      BG_DUMMY.rotation.set(0, 0, 0)
      BG_DUMMY.position.set(t.x, MEADOW_Y + 1.14, t.z)
      BG_DUMMY.scale.set(t.r, 1, t.r)
      BG_DUMMY.updateMatrix()
      top.setMatrixAt(i, BG_DUMMY.matrix)
      top.setColorAt(i, t.felt)
      BG_DUMMY.position.set(t.x, MEADOW_Y + 0.57, t.z)
      BG_DUMMY.scale.set(1, 1, 1)
      BG_DUMMY.updateMatrix()
      base.setMatrixAt(i, BG_DUMMY.matrix)
    })
    layout.figures.forEach((f, i) => {
      BG_DUMMY.rotation.set(0, f.yaw, 0)
      BG_DUMMY.scale.setScalar(f.s)
      BG_DUMMY.position.set(f.x, MEADOW_Y + 0.78 * f.s, f.z)
      BG_DUMMY.updateMatrix()
      body.setMatrixAt(i, BG_DUMMY.matrix)
      body.setColorAt(i, f.tint)
      BG_DUMMY.position.set(f.x, MEADOW_Y + 1.5 * f.s, f.z)
      BG_DUMMY.updateMatrix()
      head.setMatrixAt(i, BG_DUMMY.matrix)
      head.setColorAt(i, f.tint)
    })
    for (const m of [top, base, body, head]) m.instanceMatrix.needsUpdate = true
    for (const m of [top, body, head]) { if (m.instanceColor) m.instanceColor.needsUpdate = true }
  }, [layout])

  // Tiny head bob so the crowd reads alive — frozen under reduced motion.
  useFrame(({ clock }) => {
    const head = headRef.current
    if (!head || reduced) return
    const t = clock.elapsedTime
    layout.figures.forEach((f, i) => {
      BG_DUMMY.rotation.set(0, f.yaw, 0)
      BG_DUMMY.scale.setScalar(f.s)
      BG_DUMMY.position.set(f.x, MEADOW_Y + 1.5 * f.s + Math.sin(t * 1.4 + f.phase) * 0.022, f.z)
      BG_DUMMY.updateMatrix()
      head.setMatrixAt(i, BG_DUMMY.matrix)
    })
    head.instanceMatrix.needsUpdate = true
  })

  return (
    // frustumCulled off: instanced bounds ignore per-instance transforms
    <group>
      <instancedMesh ref={topRef} args={[undefined, undefined, layout.tables.length]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 0.12, 18]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={baseRef} args={[undefined, undefined, layout.tables.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.16, 0.42, 1.14, 10]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, layout.figures.length]} frustumCulled={false}>
        <capsuleGeometry args={[0.3, 0.5, 3, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, layout.figures.length]} frustumCulled={false}>
        <sphereGeometry args={[0.21, 10, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.7} />
      </instancedMesh>
      {/* warm lantern dots on a few tables — cozy points of light in the field */}
      <instancedMesh args={[undefined, undefined, layout.lanterns.length]} frustumCulled={false}
        ref={(mesh: InstancedMesh | null) => {
          if (!mesh) return
          layout.lanterns.forEach(([x, y, z], i) => {
            BG_DUMMY.rotation.set(0, 0, 0)
            BG_DUMMY.scale.setScalar(1)
            BG_DUMMY.position.set(x, y, z)
            BG_DUMMY.updateMatrix()
            mesh.setMatrixAt(i, BG_DUMMY.matrix)
          })
          mesh.instanceMatrix.needsUpdate = true
        }}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

// ---- the table ---------------------------------------------------------------------

function Table() {
  return (
    <group>
      {/* felt top */}
      <mesh position={[0, -0.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.24, 48]} />
        <meshStandardMaterial color={FELT} roughness={0.95} />
      </mesh>
      {/* wooden rim */}
      <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[TABLE_R, 0.14, 12, 64]} />
        <meshStandardMaterial color={WOOD_RIM} roughness={0.55} />
      </mesh>
      {/* skirt + pedestal down to the deck */}
      <mesh position={[0, -0.6, 0]} castShadow>
        <cylinderGeometry args={[TABLE_R - 0.05, TABLE_R - 0.35, 0.75, 48]} />
        <meshStandardMaterial color={WOOD_SKIRT} roughness={0.9} />
      </mesh>
      <mesh position={[0, (DECK_TOP_Y - 0.95) / 2, 0]}>
        <cylinderGeometry args={[0.75, 1.5, -0.95 - DECK_TOP_Y, 24]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={1} />
      </mesh>
    </group>
  )
}

// ---- camera rig ---------------------------------------------------------------------
// The camera is the storyteller. Three framings, eased between:
//   you   — close on your hand, table centre above it (any phase where you act)
//   watch — pulled back and turned toward the ACTIVE opponent, hand minimized
//   wide  — game over: high and wide over the whole table
// Under reduced motion the rig SNAPS between framings (no swooping).

type Framing = 'you' | 'watch' | 'wide'

// Framings tilt up enough that the horizon and sun stay in the top of frame.
const CAM_YOU: readonly [number, number, number] = [0, 3.9, 8.4]
const LOOK_YOU: readonly [number, number, number] = [0, 1.0, -2.2]
const CAM_WATCH: readonly [number, number, number] = [0, 4.7, 9.6]
const CAM_WIDE: readonly [number, number, number] = [0, 6.2, 10.4]
const HAND_MIN: readonly [number, number, number] = [0, 0.42, 3.7] // minimized fan, low at the table edge
const HAND_MIN_SCALE = 0.4
const CAM_EASE = 3.0 // 1/s — the framing glide
const CAM_SCRATCH = new Vector3() // per-frame camera target — never allocated in the loop

function framingFor(view: CardGameView): Framing {
  if (view.phase === 'gameover') return 'wide'
  return view.yourTurn ? 'you' : 'watch'
}

function CameraRig({ view, reduced, handRef }: {
  view: CardGameView
  reduced: boolean
  handRef: React.RefObject<Group>
}) {
  // Persistent targets, mutated in render — never allocated per frame.
  const rig = useRef({
    cam: new Vector3(...CAM_YOU),
    look: new Vector3(...LOOK_YOU),
    lookCur: new Vector3(...LOOK_YOU),
    hand: new Vector3(...HAND_POS),
    scale: 1,
  }).current

  const framing = framingFor(view)
  const total = view.seats.length + 1
  const activeIdx = view.seats.findIndex((s) => s.current)
  if (framing === 'you') {
    rig.cam.set(...CAM_YOU)
    rig.look.set(...LOOK_YOU)
    rig.hand.set(...HAND_POS)
    rig.scale = 1
  } else {
    rig.cam.set(...(framing === 'wide' ? CAM_WIDE : CAM_WATCH))
    rig.hand.set(...HAND_MIN)
    rig.scale = HAND_MIN_SCALE
    if (framing === 'watch' && activeIdx >= 0) {
      const seat = seatPosition(activeIdx + 1, total)
      rig.look.set(seat.x * 0.8, 1.15, seat.z * 0.8)
    } else {
      rig.look.set(0, 0.7, -0.8)
    }
  }

  useFrame(({ camera, size }, dt) => {
    const hand = handRef.current
    // Narrow viewports see a narrower horizontal FOV — pull the camera back
    // proportionally so the whole table (and every seat) stays in frame.
    const aspect = size.width / Math.max(1, size.height)
    const stretch = aspect >= 1.5 ? 1 : 1 + (1.5 - aspect) * 0.52
    CAM_SCRATCH.copy(rig.cam)
    CAM_SCRATCH.z *= stretch
    CAM_SCRATCH.y *= 1 + (stretch - 1) * 0.4
    if (reduced) {
      camera.position.copy(CAM_SCRATCH)
      rig.lookCur.copy(rig.look)
      camera.lookAt(rig.lookCur)
      if (hand) { hand.position.copy(rig.hand); hand.scale.setScalar(rig.scale) }
      return
    }
    const ease = 1 - Math.exp(-CAM_EASE * Math.min(dt, 0.05))
    camera.position.lerp(CAM_SCRATCH, ease)
    rig.lookCur.lerp(rig.look, ease)
    camera.lookAt(rig.lookCur)
    if (hand) {
      hand.position.lerp(rig.hand, ease)
      const s = hand.scale.x + (rig.scale - hand.scale.x) * ease
      hand.scale.setScalar(s)
    }
  })

  return null
}

// ---- the scene --------------------------------------------------------------------

function Scene({ view, accent, skins, reduced, focusedId, onActivate }: {
  view: CardGameView
  accent: string
  skins: CardSkins
  reduced: boolean
  focusedId: string | null
  onActivate: (card: Card) => void
}) {
  const cardGeo = useMemo(() => new PlaneGeometry(CARD_W, CARD_H), [])
  useEffect(() => () => cardGeo.dispose(), [cardGeo])
  const total = view.seats.length + 1
  const handRef = useRef<Group>(null)

  return (
    <>
      <fog attach="fog" args={SUNSET_FOG} />
      <SunsetLights />

      <SunsetWorld reduced={reduced} groundY={DECK_TOP_Y} deck />
      <BackgroundGathering reduced={reduced} />
      <StringLights />
      <Table />
      <TableCentre view={view} skins={skins} cardGeo={cardGeo} reduced={reduced} />
      {view.seats.map((seat, i) => (
        <OpponentSeat key={seat.name} seat={seat} index={i + 1} total={total} skins={skins} cardGeo={cardGeo} accent={accent} reduced={reduced} />
      ))}
      <Hand view={view} skins={skins} cardGeo={cardGeo} accent={accent} focusedId={focusedId} onActivate={onActivate} groupRef={handRef} />
      <CameraRig view={view} reduced={reduced} handRef={handRef} />
    </>
  )
}

// ---- component ---------------------------------------------------------------------

export default function CardTable3D({ view, accent, reduced, onCardActivate }: {
  view: CardGameView
  accent: string
  reduced: boolean
  onCardActivate: (card: Card) => void
}) {
  // Bake face textures only once the serif is actually loaded — canvas text
  // never triggers a webfont fetch on its own, so request the face explicitly
  // and rebuild the skin cache when it lands (the fallback serif bakes are
  // discarded; the old materials are disposed by the effect below).
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    let live = true
    void Promise.all([
      document.fonts.load(`600 196px ${SERIF_FAMILY}`),
      document.fonts.ready,
    ]).then(() => { if (live) setFontsReady(true) })
    return () => { live = false }
  }, [])
  const skins = useMemo(() => new CardSkins(), [fontsReady])
  useEffect(() => () => skins.dispose(), [skins])
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const { hand, legal, stackable, phase, yourTurn } = view
  const actionable = phase === 'choose' ? legal : phase === 'penalty' ? stackable : []
  const actionableIds = new Set(actionable.map((c) => c.id))
  const handInteractive = phase === 'choose' || phase === 'penalty'

  // A phase change can disable the focused button without a blur event —
  // never leave a stale highlight/caption up.
  useEffect(() => { if (!handInteractive) setFocusedId(null) }, [handInteractive])

  const turnText = yourTurn
    ? (phase === 'penalty' ? 'STACK OR TAKE' : 'YOUR TURN')
    : phase === 'gameover' ? 'GAME OVER' : `${view.seats.find((s) => s.current)?.name ?? 'CPU'} PLAYING…`

  return (
    <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-[#0a0620]">
      <div className="h-[380px] sm:h-[470px]">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.12 }}
          camera={{ fov: 50, near: 0.1, far: 500, position: [0, 3.9, 8.4] }}
          aria-label="3D card table"
          role="img"
        >
          <Scene view={view} accent={accent} skins={skins} reduced={reduced} focusedId={focusedId} onActivate={onCardActivate} />
        </Canvas>
      </div>

      {/* turn banner over the canvas */}
      <div className="pointer-events-none absolute top-2.5 inset-x-0 text-center">
        <span className="inline-block font-sans font-semibold text-[13px] tracking-wide rounded-full px-4 py-1.5"
          style={{ color: '#ffffff', background: 'rgba(22,14,10,0.78)', border: `1px solid ${yourTurn ? accent : 'rgba(255,255,255,0.22)'}` }}>
          {turnText}
        </span>
      </div>

      {/* keyboard/AT hand — visually hidden buttons mirroring the 3D fan */}
      <div role="group" aria-label="Your hand" className="sr-only">
        {hand.map((card) => {
          const active = actionableIds.has(card.id)
          return (
            <button
              key={card.id}
              type="button"
              disabled={!handInteractive || !active}
              onClick={() => onCardActivate(card)}
              onFocus={() => setFocusedId(card.id)}
              onBlur={() => setFocusedId((f) => (f === card.id ? null : f))}
              aria-label={cardAria(card, active, phase)}
            >
              {describeCard(card)}
            </button>
          )
        })}
      </div>

      {/* keyboard caption — names the focused card over the canvas */}
      {handInteractive && focusedId && (() => {
        const card = hand.find((c) => c.id === focusedId)
        if (!card) return null
        return (
          <div className="pointer-events-none absolute bottom-2.5 inset-x-0 text-center">
            <span className="inline-block font-sans font-semibold text-[12px] tracking-wide rounded-full px-4 py-1.5"
              style={{ color: '#ffffff', background: 'rgba(22,14,10,0.85)', border: '1px solid rgba(255,255,255,0.35)' }}>
              {describeCard(card)} — Enter to {phase === 'penalty' ? 'stack' : 'play'}
            </span>
          </div>
        )
      })()}
    </div>
  )
}

function cardAria(card: Card, active: boolean, phase: CardPhase): string {
  const name = describeCard(card)
  if (!active) return `${name}, not playable`
  return phase === 'penalty' ? `${name}, stack to pass the penalty` : `${name}, play`
}
