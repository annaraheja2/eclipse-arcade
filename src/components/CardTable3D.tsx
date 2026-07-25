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
import type { Card, Color } from '../lib/cardgame'
import { cardGlyph, colorName, describeCard } from '../lib/cardgameView'
import type { CardGameView, CardPhase } from '../hooks/useCardGame'

// ---- palette (mirrors CardFace.tsx so 2D overlays and 3D faces agree) -------
const SKIN: Record<Color, { fill: string; edge: string; ink: string }> = {
  red: { fill: '#c62828', edge: '#7f1414', ink: '#ffffff' },
  yellow: { fill: '#e0a200', edge: '#906500', ink: '#1a1400' },
  green: { fill: '#1f9d4d', edge: '#0f5e2c', ink: '#ffffff' },
  blue: { fill: '#2f6fd8', edge: '#123f8c', ink: '#ffffff' },
}
const QUAD_COLORS = ['#c62828', '#e0a200', '#1f9d4d', '#2f6fd8'] as const
// ---- golden-hour palette -----------------------------------------------------
const HAZE = '#f0a066' // warm atmospheric haze — the fog AND the horizon band
const DUSK_DIM = '#3a2f45' // dimmed characters/cards sink toward dusk, not void
const FELT = '#2e6647' // classic deep-green card felt, warmed by the sun
const WOOD_RIM = '#7a5230'
const WOOD_SKIRT = '#5d3f26'
const WOOD_DARK = '#46301c'
const DECK_TOP_Y = -1.35 // the wooden deck surface the table stands on
// Placeholder-character tints, one per seat (0 = you). Swap the Character
// component below for real designs later — everything else stays.
const SEAT_TINTS = ['#7c3aff', '#ff4d8d', '#3df5ff', '#3dffa2', '#ffb43d'] as const

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

const FACE_W = 256
const FACE_H = 384
// Clean geometric sans for everything drawn to canvas — no pixel glyphs.
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

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

// A clean modern playing card: white body, thin inner frame, big colored
// center pip on a soft tinted disc, crisp corner indices, and the color NAME
// pinned bottom-left (fans overlap from the right — the left strip survives).
function drawFace(ctx: CanvasRenderingContext2D, card: Card) {
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  const skin = card.color ? SKIN[card.color] : null
  const accent = skin ? skin.fill : '#2b2438'
  // yellow pips need the darker edge tone to read on the white card stock
  const ink = card.color === 'yellow' ? SKIN.yellow.edge : accent
  const glyph = cardGlyph(card)

  // card body — near-white with a faint top-light sheen
  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 24)
  const body = ctx.createLinearGradient(0, 0, 0, FACE_H)
  body.addColorStop(0, '#fdfbf7')
  body.addColorStop(1, '#ece7de')
  ctx.fillStyle = body
  ctx.fill()
  // soft outer edge so stacked cards separate
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(30,24,20,0.35)'
  roundedRect(ctx, 1.5, 1.5, FACE_W - 3, FACE_H - 3, 22)
  ctx.stroke()
  // the colored inner frame
  ctx.lineWidth = 7
  ctx.strokeStyle = accent
  roundedRect(ctx, 12, 12, FACE_W - 24, FACE_H - 24, 16)
  ctx.stroke()

  if (isWild) {
    // charcoal panel with the four-color quad
    roundedRect(ctx, 12, 12, FACE_W - 24, FACE_H - 24, 16)
    ctx.fillStyle = '#2b2438'
    ctx.fill()
    const s = 58
    const cx = FACE_W / 2
    const cy = FACE_H / 2 - 22
    const gap = 5
    QUAD_COLORS.forEach((c, i) => {
      const dx = i % 2 === 0 ? -s - gap : gap
      const dy = i < 2 ? -s - gap : gap
      roundedRect(ctx, cx + dx, cy + dy, s, s, 12)
      ctx.fillStyle = c
      ctx.fill()
    })
    if (card.kind === 'wild4') {
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 44px ${SANS}`
      ctx.fillText('+4', cx, cy + s + gap + 34)
    }
  } else {
    // tinted center disc carrying the big pip
    ctx.beginPath()
    ctx.ellipse(FACE_W / 2, FACE_H / 2 - 14, 86, 104, 0, 0, Math.PI * 2)
    ctx.fillStyle = `${accent}22`
    ctx.fill()
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${card.kind === 'number' ? 128 : 56}px ${SANS}`
    ctx.fillText(glyph, FACE_W / 2, FACE_H / 2 - 14)
    // corner indices — top-left, and rotated bottom-right
    ctx.font = `700 36px ${SANS}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(glyph, 24, 22)
    ctx.save()
    ctx.translate(FACE_W - 24, FACE_H - 22)
    ctx.rotate(Math.PI)
    ctx.fillText(glyph, 0, 0)
    ctx.restore()
  }

  // color/kind name — the non-color signal, white on a dark pill for AA.
  const label = isWild ? (card.kind === 'wild4' ? 'WILD +4' : 'WILD') : colorName(card.color!).toUpperCase()
  ctx.font = `700 24px ${SANS}`
  const tw = ctx.measureText(label).width
  roundedRect(ctx, 16, FACE_H - 60, tw + 26, 38, 12)
  ctx.fillStyle = 'rgba(20,14,10,0.72)'
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 29, FACE_H - 40)
}

function drawBack(ctx: CanvasRenderingContext2D) {
  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 24)
  const g = ctx.createLinearGradient(0, 0, FACE_W, FACE_H)
  g.addColorStop(0, '#3b3560')
  g.addColorStop(1, '#211c3c')
  ctx.fillStyle = g
  ctx.fill()
  // cream frame, like a real deck's back
  ctx.lineWidth = 8
  ctx.strokeStyle = '#e8ddc8'
  roundedRect(ctx, 10, 10, FACE_W - 20, FACE_H - 20, 18)
  ctx.stroke()
  // the Eclipse crescent motif in muted gold
  const cx = FACE_W / 2
  const cy = FACE_H / 2
  ctx.beginPath()
  ctx.arc(cx, cy, 62, 0, Math.PI * 2)
  ctx.fillStyle = '#d9b36a'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + 24, cy - 17, 55, 0, Math.PI * 2)
  ctx.fillStyle = '#282247'
  ctx.fill()
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

// ---- placeholder characters ---------------------------------------------------
// Deliberately simple team-tinted figures (torso + head + arms) so real designs
// can replace this ONE component later without touching layout or camera.

function Character({ tint, dimmed }: { tint: string; dimmed: boolean }) {
  const body = useMemo(() => {
    const c = new ThreeColor(tint)
    if (dimmed) c.lerp(new ThreeColor(DUSK_DIM), 0.3)
    return c
  }, [tint, dimmed])
  const head = useMemo(() => {
    const c = new ThreeColor(tint).lerp(new ThreeColor('#ffffff'), 0.45)
    if (dimmed) c.lerp(new ThreeColor(DUSK_DIM), 0.3)
    return c
  }, [tint, dimmed])
  return (
    <group>
      {/* torso */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.42, 0.7, 4, 12]} />
        <meshStandardMaterial color={body} roughness={0.7} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.95, 0]} castShadow>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshStandardMaterial color={head} roughness={0.6} />
      </mesh>
      {/* visor band — gives the head a facing */}
      <mesh position={[0, 1.96, 0.24]}>
        <boxGeometry args={[0.36, 0.13, 0.1]} />
        <meshStandardMaterial color="#2b2233" roughness={0.3} />
      </mesh>
      {/* arms resting toward the table */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.5, 1.0, 0.3]} rotation={[0.9, 0, s * -0.5]}>
          <capsuleGeometry args={[0.13, 0.55, 3, 8]} />
          <meshStandardMaterial color={body} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
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
        <Character tint={SEAT_TINTS[index % SEAT_TINTS.length]} dimmed={!seat.current} />
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

  const colorHex = currentColor ? SKIN[currentColor].fill : '#ffffff'
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
    ctx.fillStyle = SKIN[currentColor].fill
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

// ---- the sunset world -------------------------------------------------------------
// A hand-tuned gradient dome (vivid gold at the horizon, dusky violet-blue
// overhead), a low sun disc with a cheap billboard glow, silhouetted hills, a
// lake whose "reflection" is a gradient streak plane — no reflection pass, no
// post. Warm fog carries the haze; the dome itself is never fogged/tone-mapped.

const SUN_POS: readonly [number, number, number] = [-11, 5.6, -95]

function gradientTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

function makeSkyTexture(): CanvasTexture {
  return gradientTexture(1, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512) // zenith (top) → below horizon
    g.addColorStop(0, '#232a54')
    g.addColorStop(0.16, '#3a3168')
    g.addColorStop(0.28, '#653d74')
    g.addColorStop(0.37, '#95446e')
    g.addColorStop(0.43, '#c65058')
    g.addColorStop(0.465, '#e86a41')
    g.addColorStop(0.49, '#ff9040')
    g.addColorStop(0.51, '#ffb257')
    g.addColorStop(0.535, '#ffcd7e')
    // below the horizon the dome darkens toward the tone-mapped haze the
    // fogged ground actually renders as — hides the ground/dome seam
    g.addColorStop(0.6, '#e39a5f')
    g.addColorStop(0.72, '#cf8351')
    g.addColorStop(1, '#c07a4c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1, 512)
  })
}

/** Broad warm glow — also reused for the string-light bulb halos. */
function makeSunGlowTexture(): CanvasTexture {
  return gradientTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,236,190,0.95)')
    g.addColorStop(0.22, 'rgba(255,190,110,0.55)')
    g.addColorStop(0.55, 'rgba(255,150,70,0.18)')
    g.addColorStop(1, 'rgba(255,140,60,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  })
}

/** Tight corona hugging the sun disc so the orb reads as a defined body. */
function makeSunHaloTexture(): CanvasTexture {
  return gradientTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,248,222,1)')
    g.addColorStop(0.34, 'rgba(255,240,196,0.95)')
    g.addColorStop(0.45, 'rgba(255,206,130,0.5)')
    g.addColorStop(0.7, 'rgba(255,170,90,0.14)')
    g.addColorStop(1, 'rgba(255,150,70,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  })
}

/** A fan of god rays baked into one radial texture — a single additive quad. */
function makeSunRayTexture(): CanvasTexture {
  return gradientTexture(512, 512, (ctx) => {
    ctx.translate(256, 256)
    const rays = [0, 0.55, 1.15, 1.8, 2.4, 2.95, 3.6, 4.2, 4.8, 5.45] as const
    const widths = [0.10, 0.05, 0.13, 0.06, 0.11, 0.05, 0.12, 0.07, 0.10, 0.06] as const
    const alphas = [0.30, 0.16, 0.34, 0.18, 0.28, 0.15, 0.32, 0.20, 0.26, 0.16] as const
    rays.forEach((angle, i) => {
      ctx.save()
      ctx.rotate(angle + 0.23)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.tan(widths[i]) * 260, -260)
      ctx.lineTo(-Math.tan(widths[i]) * 260, -260)
      ctx.closePath()
      ctx.fillStyle = `rgba(255,196,120,${alphas[i]})`
      ctx.fill()
      ctx.restore()
    })
    // radial falloff mask so the rays melt into the sky, never a hard rim
    ctx.globalCompositeOperation = 'destination-in'
    const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, 256)
    mask.addColorStop(0, 'rgba(0,0,0,1)')
    mask.addColorStop(0.3, 'rgba(0,0,0,0.85)')
    mask.addColorStop(0.7, 'rgba(0,0,0,0.3)')
    mask.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = mask
    ctx.fillRect(-256, -256, 512, 512)
  })
}

/** Sunset stratus bands: elongated puffs, gold-lit undersides, cooler tops. */
function makeCloudTexture(variant: 0 | 1): CanvasTexture {
  return gradientTexture(512, 192, (ctx) => {
    const puffs: readonly (readonly [number, number, number, number])[] = variant === 0
      ? [[130, 108, 118, 26], [280, 88, 150, 30], [400, 116, 96, 20], [210, 128, 130, 18]]
      : [[110, 96, 96, 22], [250, 118, 160, 24], [396, 92, 104, 26], [330, 136, 110, 16]]
    ctx.filter = 'blur(7px)'
    for (const [x, y, rx, ry] of puffs) {
      const g = ctx.createLinearGradient(0, y - ry, 0, y + ry)
      g.addColorStop(0, 'rgba(206,156,184,0.92)') // cool violet top
      g.addColorStop(0.55, 'rgba(244,166,120,0.95)')
      g.addColorStop(1, 'rgba(255,215,156,0.98)') // sun-struck gold underside
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      // hot gilt edge along the bottom of each band
      ctx.fillStyle = 'rgba(255,234,180,0.85)'
      ctx.beginPath()
      ctx.ellipse(x, y + ry * 0.66, rx * 0.8, ry * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.filter = 'none'
  })
}

// Cloud bands parked near the horizon: [x, y, z, width, variant]. Drift is a
// slow sway around these anchors (frozen under reduced motion).
const CLOUDS: readonly (readonly [number, number, number, number, 0 | 1])[] = [
  [-118, 27, -252, 78, 0],
  [-46, 15, -246, 56, 1],
  [34, 31, -250, 88, 0],
  [96, 19, -244, 62, 1],
  [162, 36, -236, 72, 0],
  [-180, 38, -238, 80, 1],
]

function Clouds({ reduced }: { reduced: boolean }) {
  const tex0 = useMemo(() => makeCloudTexture(0), [])
  const tex1 = useMemo(() => makeCloudTexture(1), [])
  useEffect(() => () => { tex0.dispose(); tex1.dispose() }, [tex0, tex1])
  const groupRef = useRef<Group>(null)
  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group || reduced) return
    const t = clock.elapsedTime
    group.children.forEach((cloud, i) => {
      cloud.position.x = CLOUDS[i][0] + Math.sin(t * 0.016 + i * 1.7) * 7
    })
  })
  return (
    <group ref={groupRef}>
      {CLOUDS.map(([x, y, z, w, v], i) => (
        <mesh key={i} position={[x, y, z]}>
          <planeGeometry args={[w, w * 0.34]} />
          <meshBasicMaterial map={v === 0 ? tex0 : tex1} transparent fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function makeLakeTexture(): CanvasTexture {
  return gradientTexture(8, 128, (ctx) => {
    // far edge (toward the sun) blazes; the near shore cools and darkens
    const g = ctx.createLinearGradient(0, 0, 0, 128)
    g.addColorStop(0, 'rgba(255,226,164,0.98)')
    g.addColorStop(0.4, 'rgba(244,158,106,0.94)')
    g.addColorStop(0.75, 'rgba(172,108,122,0.92)')
    g.addColorStop(1, 'rgba(104,78,118,0.9)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 8, 128)
  })
}

/** Tiny deterministic PRNG so baked "random" detail is stable across mounts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The sun's reflection column: horizontal glints that shimmer down the lake. */
function makeShimmerTexture(): CanvasTexture {
  const tex = gradientTexture(64, 256, (ctx) => {
    const rnd = mulberry32(7)
    for (let i = 0; i < 34; i++) {
      const y = rnd() * 256
      const w = 8 + rnd() * 40
      const near = y / 256 // 0 = far (bright), 1 = near (sparse)
      const a = (0.9 - near * 0.55) * (0.5 + rnd() * 0.5)
      ctx.fillStyle = `rgba(255,${224 - near * 40 | 0},${150 - near * 30 | 0},${a.toFixed(3)})`
      ctx.fillRect(32 - w / 2 + (rnd() - 0.5) * (10 + near * 26), y, w, 1.6 + rnd() * 2)
    }
  })
  tex.wrapT = RepeatWrapping
  return tex
}

/** A mountain ridge silhouette (white, alpha-cut) tinted per range. */
function makeRidgeTexture(points: readonly (readonly [number, number])[]): CanvasTexture {
  return gradientTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(-8, 256)
    ctx.lineTo(-8, 256 - points[0][1] * 256)
    // smooth the ridgeline through midpoints so peaks roll instead of zig-zag
    for (let i = 0; i < points.length - 1; i++) {
      const [u0, h0] = points[i]
      const [u1, h1] = points[i + 1]
      const mx = ((u0 + u1) / 2) * 1024
      const my = 256 - ((h0 + h1) / 2) * 256
      ctx.quadraticCurveTo(u0 * 1024, 256 - h0 * 256, mx, my)
    }
    const [ul, hl] = points[points.length - 1]
    ctx.lineTo(ul * 1024 + 8, 256 - hl * 256)
    ctx.lineTo(1032, 256)
    ctx.closePath()
    ctx.fill()
  })
}

// Three ranges receding to the horizon — each further one lighter and warmer
// (atmospheric perspective), with a shared valley around the sun/lake axis.
const RIDGE_FAR: readonly (readonly [number, number])[] = [
  [0, 0.6], [0.08, 0.82], [0.16, 0.58], [0.24, 0.72], [0.3, 0.88], [0.37, 0.52],
  [0.44, 0.36], [0.5, 0.3], [0.56, 0.42], [0.62, 0.95], [0.7, 0.66], [0.78, 0.84], [0.88, 0.56], [1, 0.7],
]
const RIDGE_MID: readonly (readonly [number, number])[] = [
  [0, 0.5], [0.1, 0.34], [0.2, 0.62], [0.28, 0.4], [0.36, 0.26], [0.46, 0.2],
  [0.54, 0.28], [0.63, 0.58], [0.72, 0.38], [0.8, 0.52], [0.9, 0.3], [1, 0.44],
]
const RIDGE_NEAR: readonly (readonly [number, number])[] = [
  [0, 0.4], [0.12, 0.52], [0.24, 0.3], [0.36, 0.2], [0.48, 0.16], [0.6, 0.26],
  [0.7, 0.46], [0.8, 0.3], [0.9, 0.42], [1, 0.32],
]

/** Backlit tree silhouettes — three profiles drawn once, shared by billboards
 *  that face the camera side (the rig never orbits behind the table). */
function makeTreeTexture(variant: 0 | 1 | 2): CanvasTexture {
  return gradientTexture(256, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#54382a') // faint warm rim where the sky grazes the crown
    g.addColorStop(0.6, '#33231a')
    g.addColorStop(1, '#221812')
    ctx.fillStyle = g
    const canopy = (blobs: readonly (readonly [number, number, number, number])[]) => {
      ctx.beginPath()
      for (const [x, y, rx, ry] of blobs) {
        ctx.moveTo(x + rx, y)
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    if (variant === 0) {
      // lone round-crowned deciduous
      ctx.fillRect(116, 290, 24, 222)
      canopy([[128, 205, 98, 92], [70, 262, 62, 54], [188, 252, 60, 52], [98, 142, 58, 50], [168, 150, 52, 46]])
    } else if (variant === 1) {
      // conifer: stacked drooping tiers
      ctx.fillRect(120, 400, 16, 112)
      ctx.beginPath()
      const tiers: readonly (readonly [number, number])[] = [[110, 52], [200, 84], [290, 116], [385, 148]]
      for (const [y, w] of tiers) {
        ctx.moveTo(128, y - 96)
        ctx.quadraticCurveTo(128 + w * 0.55, y - 18, 128 + w, y + 12)
        ctx.quadraticCurveTo(128, y - 8, 128 - w, y + 12)
        ctx.quadraticCurveTo(128 - w * 0.55, y - 18, 128, y - 96)
      }
      ctx.fill()
    } else {
      // clustered grove: three trunks under one broad merged crown
      ctx.fillRect(62, 320, 18, 192)
      ctx.fillRect(120, 300, 20, 212)
      ctx.fillRect(182, 330, 16, 182)
      canopy([[128, 210, 124, 88], [58, 258, 56, 48], [198, 252, 58, 50], [128, 128, 78, 56], [70, 170, 52, 44], [186, 166, 54, 44]])
    }
  })
}

// Tree line: [x, z, height, variant]. Clusters frame the mid-ground and two
// bigger ones sit close for depth; the sun/lake corridor stays open.
const TREES: readonly (readonly [number, number, number, 0 | 1 | 2])[] = [
  [-24, -44, 8, 2], [-34, -52, 10, 1], [-46, -62, 11, 0], [-60, -50, 9, 1],
  [-74, -70, 12, 2], [-92, -95, 13, 1],
  [26, -48, 9, 0], [38, -60, 11, 1], [52, -46, 8, 2], [66, -64, 12, 0],
  [30, -80, 10, 1], [96, -92, 14, 0],
  // lakeshore accents against the water's glow
  [-44, -98, 7, 1], [-56, -92, 8, 0], [24, -98, 7, 2], [48, -90, 9, 1],
  // near framing pair — single-trunk crowns so they read clean up close
  [-26, -32, 10, 0], [28, -36, 12, 0],
]
const TREE_W = [0.72, 0.52, 1.12] as const // width/height per variant profile

/** Rolling meadow map: warm gradient out from the table + soft mottling, so
 *  the plain reads as grass catching low light instead of flat olive. */
function makeGroundTexture(): CanvasTexture {
  return gradientTexture(512, 512, (ctx) => {
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 260)
    g.addColorStop(0, '#5e7040')
    g.addColorStop(0.35, '#6e7440')
    g.addColorStop(0.7, '#8a7346')
    g.addColorStop(1, '#a67a4a')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    const rnd = mulberry32(21)
    ctx.filter = 'blur(5px)'
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 512
      const y = rnd() * 512
      const r = 8 + rnd() * 34
      const dark = rnd() > 0.45
      ctx.fillStyle = dark ? 'rgba(62,76,40,0.28)' : 'rgba(158,140,74,0.22)'
      ctx.beginPath()
      ctx.ellipse(x, y, r * (1 + rnd()), r * 0.6, rnd() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.filter = 'none'
  })
}

function makeDeckTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#7d5533'
    ctx.fillRect(0, 0, 256, 256)
    const tones = ['#84592f', '#775030', '#8a5f38', '#71482a']
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = tones[i % tones.length]
      ctx.fillRect(0, i * 32, 256, 32)
      ctx.fillStyle = 'rgba(40,24,12,0.55)'
      ctx.fillRect(0, i * 32, 256, 2)
    }
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(3, 3)
  return tex
}

/** Sky dome, sun, hills, lake, grass, deck — everything around the table. */
function SunsetWorld({ reduced }: { reduced: boolean }) {
  const skyTex = useMemo(makeSkyTexture, [])
  const glowTex = useMemo(makeSunGlowTexture, [])
  const haloTex = useMemo(makeSunHaloTexture, [])
  const rayTex = useMemo(makeSunRayTexture, [])
  const lakeTex = useMemo(makeLakeTexture, [])
  const shimmerTex = useMemo(makeShimmerTexture, [])
  const groundTex = useMemo(makeGroundTexture, [])
  const ridgeFarTex = useMemo(() => makeRidgeTexture(RIDGE_FAR), [])
  const ridgeMidTex = useMemo(() => makeRidgeTexture(RIDGE_MID), [])
  const ridgeNearTex = useMemo(() => makeRidgeTexture(RIDGE_NEAR), [])
  const deckTex = useMemo(makeDeckTexture, [])
  const treeMats = useMemo(() => ([0, 1, 2] as const).map((v) =>
    new MeshBasicMaterial({ map: makeTreeTexture(v), alphaTest: 0.5 })), [])
  useEffect(() => () => {
    skyTex.dispose(); glowTex.dispose(); haloTex.dispose(); rayTex.dispose()
    lakeTex.dispose(); shimmerTex.dispose(); groundTex.dispose()
    ridgeFarTex.dispose(); ridgeMidTex.dispose(); ridgeNearTex.dispose(); deckTex.dispose()
    for (const m of treeMats) { m.map?.dispose(); m.dispose() }
  }, [skyTex, glowTex, haloTex, rayTex, lakeTex, shimmerTex, groundTex, ridgeFarTex, ridgeMidTex, ridgeNearTex, deckTex, treeMats])
  // the lake's glints crawl toward the shore — frozen under reduced motion
  useFrame((_, dt) => {
    if (!reduced) shimmerTex.offset.y -= dt * 0.018
  })
  return (
    <group>
      {/* sky dome — the gradient IS the final colour: no fog, no tone map */}
      <mesh>
        <sphereGeometry args={[300, 24, 24]} />
        <meshBasicMaterial map={skyTex} side={BackSide} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      <Clouds reduced={reduced} />
      {/* the sun: a defined orb on the horizon — broad ambient glow, a fan of
          god rays, the crisp disc, and a tight corona hugging it */}
      <group position={[SUN_POS[0], SUN_POS[1], SUN_POS[2]]}>
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[74, 74]} />
          <meshBasicMaterial map={glowTex} transparent fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, -1]} rotation={[0, 0, 0.3]}>
          <planeGeometry args={[120, 120]} />
          <meshBasicMaterial map={rayTex} transparent blending={AdditiveBlending} opacity={0.55} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh>
          <circleGeometry args={[4.1, 48]} />
          <meshBasicMaterial color="#fff6d8" fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, 0.5]}>
          <planeGeometry args={[20, 20]} />
          <meshBasicMaterial map={haloTex} transparent blending={AdditiveBlending} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      {/* layered mountain ranges receding to the horizon — each further range
          lighter and warmer, dissolving toward the sky (fake aerial haze) */}
      <mesh position={[0, -2 + 17, -268]}>
        <planeGeometry args={[900, 34]} />
        <meshBasicMaterial map={ridgeFarTex} color="#d4826b" alphaTest={0.5} fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[24, -2 + 13, -240]}>
        <planeGeometry args={[860, 26]} />
        <meshBasicMaterial map={ridgeMidTex} color="#9c5a70" alphaTest={0.5} fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[-30, -2 + 11, -206]}>
        <planeGeometry args={[820, 22]} />
        <meshBasicMaterial map={ridgeNearTex} color="#5c3a5e" alphaTest={0.5} fog={false} toneMapped={false} />
      </mesh>
      {/* rolling meadow, warming and hazing out toward the horizon */}
      <mesh position={[0, DECK_TOP_Y - 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[280, 48]} />
        <meshStandardMaterial map={groundTex} roughness={1} />
      </mesh>
      {/* lake catching the sun — a gradient disc (blazing at the far shore,
          cooling toward us) + the sun's shimmering reflection column: a faked
          reflection, no passes */}
      <group position={[-9, DECK_TOP_Y - 0.14, -108]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[46, 15, 1]}>
          <circleGeometry args={[1, 36]} />
          <meshBasicMaterial map={lakeTex} transparent fog={false} toneMapped={false} />
        </mesh>
        <mesh position={[-0.5, 0.05, 0]} rotation={[-Math.PI / 2, 0, -0.04]}>
          <planeGeometry args={[6.5, 28]} />
          <meshBasicMaterial map={shimmerTex} transparent blending={AdditiveBlending} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        {/* the blaze where the column meets the far shore */}
        <mesh position={[-0.5, 0.1, -12]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[12, 7]} />
          <meshBasicMaterial map={glowTex} transparent opacity={0.85} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      {/* silhouetted tree line framing the mid-ground (the centre stays open
          for the sun and its reflection) */}
      {TREES.map(([x, z, h, v], i) => (
        <mesh key={i} position={[x, DECK_TOP_Y - 0.2 + h / 2, z]} scale={[h * TREE_W[v], h, 1]}>
          <planeGeometry args={[1, 1]} />
          <primitive object={treeMats[v]} attach="material" />
        </mesh>
      ))}
      {/* the wooden deck the table sits on */}
      <mesh position={[0, DECK_TOP_Y - 0.09, 0]} receiveShadow>
        <cylinderGeometry args={[7.4, 7.4, 0.18, 40]} />
        <meshStandardMaterial map={deckTex} color="#c9a377" roughness={0.85} />
      </mesh>
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
      <fog attach="fog" args={[HAZE, 28, 215]} />
      {/* dusk-sky fill from above, warm ground bounce from below */}
      <hemisphereLight args={['#9a7fc0', '#7a5638', 0.85]} />
      {/* the sun: warm low key from behind the table — long shadows toward
          the camera, golden rims on the characters */}
      <directionalLight
        position={[-14, 8, -34]}
        intensity={2.7}
        color="#ffb46b"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
      />
      {/* soft camera-side fill so faces (cards and characters) stay readable */}
      <directionalLight position={[4, 7, 14]} intensity={0.7} color="#ffd9c0" />

      <SunsetWorld reduced={reduced} />
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
  const skins = useMemo(() => new CardSkins(), [])
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
