// The 3D card table — the real-3D presentation layer that replaced the 2D
// CardTable in the same slot. It consumes the SAME view model from useCardGame
// and routes every interaction through the same callbacks; no rules live here.
//
// Scene: a round neon-felt table with the players seated around it. Your hand
// is a fan of legible 3D cards in the near foreground; opponents sit across the
// table behind face-down fans, receding into fog. The camera is the storyteller:
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
  CanvasTexture, Color as ThreeColor, MeshBasicMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3,
} from 'three'
import type { Group, Mesh } from 'three'
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
const BASE_BG = '#0a0620'
const FELT = '#2a1857'
const FELT_EDGE = '#160c33'
const TABLE_SKIRT = '#120a2c'
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
const PIXEL_FONT = '"Press Start 2P", monospace'

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

function drawFace(ctx: CanvasRenderingContext2D, card: Card) {
  const isWild = card.kind === 'wild' || card.kind === 'wild4'
  const skin = card.color ? SKIN[card.color] : null
  const fill = skin ? skin.fill : '#171033'
  const edge = skin ? skin.edge : '#000000'
  const ink = skin ? skin.ink : '#ffffff'
  const glyph = cardGlyph(card)

  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 26)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = edge
  roundedRect(ctx, 5, 5, FACE_W - 10, FACE_H - 10, 22)
  ctx.stroke()

  // the classic slanted inner oval
  ctx.save()
  ctx.translate(FACE_W / 2, FACE_H / 2)
  ctx.rotate(-0.35)
  ctx.beginPath()
  ctx.ellipse(0, 0, FACE_W * 0.36, FACE_H * 0.42, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fill()
  ctx.restore()

  if (isWild) {
    const s = 66
    const cx = FACE_W / 2
    const cy = FACE_H / 2 - 14
    const gap = 5
    QUAD_COLORS.forEach((c, i) => {
      const dx = i % 2 === 0 ? -s - gap : gap
      const dy = i < 2 ? -s - gap : gap
      roundedRect(ctx, cx + dx, cy + dy, s, s, 10)
      ctx.fillStyle = c
      ctx.fill()
    })
  } else {
    ctx.fillStyle = ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `34px ${PIXEL_FONT}`
    ctx.fillText(glyph, 18, 18)
    ctx.save()
    ctx.translate(FACE_W - 18, FACE_H - 18)
    ctx.rotate(Math.PI)
    ctx.fillText(glyph, 0, 0)
    ctx.restore()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${card.kind === 'number' ? 118 : 52}px ${PIXEL_FONT}`
    ctx.fillText(glyph, FACE_W / 2, FACE_H / 2 - 10)
  }

  // color/kind name — the non-color signal, white on a dark pill for AA.
  // LEFT-aligned: fanned cards overlap from the right, so the left strip is
  // the part guaranteed visible — the name must live there.
  const label = isWild ? (card.kind === 'wild4' ? 'WILD +4' : 'WILD') : colorName(card.color!).toUpperCase()
  ctx.font = `20px ${PIXEL_FONT}`
  const tw = ctx.measureText(label).width
  roundedRect(ctx, 12, FACE_H - 62, tw + 24, 42, 10)
  ctx.fillStyle = 'rgba(0,0,0,0.62)'
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 24, FACE_H - 40)
}

function drawBack(ctx: CanvasRenderingContext2D) {
  roundedRect(ctx, 0, 0, FACE_W, FACE_H, 26)
  const g = ctx.createLinearGradient(0, 0, FACE_W, FACE_H)
  g.addColorStop(0, '#2a1a55')
  g.addColorStop(1, '#150c30')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = '#3a2470'
  roundedRect(ctx, 5, 5, FACE_W - 10, FACE_H - 10, 22)
  ctx.stroke()
  // the Eclipse crescent motif
  const cx = FACE_W / 2
  const cy = FACE_H / 2
  ctx.beginPath()
  ctx.arc(cx, cy, 66, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(124,58,255,0.6)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + 26, cy - 18, 58, 0, Math.PI * 2)
  ctx.fillStyle = '#150c30'
  ctx.fill()
}

const faceKey = (card: Card) => (card.kind === 'number' ? `n${card.color}${card.value}` : `${card.kind}${card.color ?? ''}`)

/** Per-mount cache of face/back textures + their unlit materials. */
class CardSkins {
  private mats = new Map<string, MeshBasicMaterial>()
  private textures: CanvasTexture[] = []

  private material(key: string, draw: (ctx: CanvasRenderingContext2D) => void): MeshBasicMaterial {
    const hit = this.mats.get(key)
    if (hit) return hit
    const tex = makeTexture(FACE_W, FACE_H, draw)
    this.textures.push(tex)
    const mat = new MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false })
    this.mats.set(key, mat)
    return mat
  }

  face(card: Card): MeshBasicMaterial {
    return this.material(faceKey(card), (ctx) => drawFace(ctx, card))
  }

  back(): MeshBasicMaterial {
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
    if (dimmed) c.lerp(new ThreeColor(BASE_BG), 0.3)
    return c
  }, [tint, dimmed])
  const head = useMemo(() => {
    const c = new ThreeColor(tint).lerp(new ThreeColor('#ffffff'), 0.45)
    if (dimmed) c.lerp(new ThreeColor(BASE_BG), 0.3)
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
        <meshStandardMaterial color="#171033" roughness={0.3} />
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
    ctx.font = `40px ${PIXEL_FONT}`
    const text = `${seat.name} · ${seat.count}`
    const tw = ctx.measureText(text).width
    roundedRect(ctx, 256 - tw / 2 - 26, 24, tw + 52, 80, 18)
    ctx.fillStyle = 'rgba(10,6,32,0.82)'
    ctx.fill()
    if (seat.current) {
      ctx.lineWidth = 6
      ctx.strokeStyle = accent
      roundedRect(ctx, 256 - tw / 2 - 26, 24, tw + 52, 80, 18)
      ctx.stroke()
    }
    ctx.fillStyle = seat.current ? '#e3d2ff' : 'rgba(255,255,255,0.88)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 66)
  }, 512, 128, labelKey)

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
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
          <pointLight position={[0, 3.2, 0.6]} intensity={14} color="#e8dcff" distance={6} decay={2} />
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
    ctx.font = `44px ${PIXEL_FONT}`
    const text = colorName(currentColor).toUpperCase()
    const tw = ctx.measureText(text).width
    const w = tw + 150
    roundedRect(ctx, 256 - w / 2, 20, w, 88, 20)
    ctx.fillStyle = 'rgba(10,6,32,0.85)'
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
                <meshBasicMaterial color="#0a0620" transparent opacity={0.55} toneMapped={false} depthWrite={false} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ---- the table + room -----------------------------------------------------------

function Room() {
  return (
    <group>
      {/* felt top */}
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.24, 48]} />
        <meshStandardMaterial color={FELT} roughness={0.95} />
      </mesh>
      {/* neon rim */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_R - 0.16, TABLE_R, 64]} />
        <meshBasicMaterial color="#7c3aff" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {/* skirt + pedestal */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[TABLE_R - 0.05, TABLE_R - 0.35, 0.75, 48]} />
        <meshStandardMaterial color={TABLE_SKIRT} roughness={1} />
      </mesh>
      <mesh position={[0, -1.6, 0]}>
        <cylinderGeometry args={[0.7, 1.1, 1.6, 24]} />
        <meshStandardMaterial color={FELT_EDGE} roughness={1} />
      </mesh>
      {/* floor */}
      <mesh position={[0, -2.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[30, 48]} />
        <meshStandardMaterial color="#0d0828" roughness={1} />
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

const CAM_YOU: readonly [number, number, number] = [0, 4.5, 8.0]
const LOOK_YOU: readonly [number, number, number] = [0, 0.15, -0.7]
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
      rig.look.set(0, 0.4, 0)
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
      <color attach="background" args={[BASE_BG]} />
      <fog attach="fog" args={[BASE_BG, 9.5, 19]} />
      <hemisphereLight args={['#5c48a8', '#0a0620', 1.5]} />
      <directionalLight position={[4, 9, 6]} intensity={2.1} color="#cfd6ff" />
      <pointLight position={[0, 5.5, 0]} intensity={46} color={accent} distance={15} decay={2} />

      <Room />
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
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ fov: 50, near: 0.1, far: 60, position: [0, 3.1, 7.6] }}
          aria-label="3D card table"
          role="img"
        >
          <Scene view={view} accent={accent} skins={skins} reduced={reduced} focusedId={focusedId} onActivate={onCardActivate} />
        </Canvas>
      </div>

      {/* turn banner over the canvas */}
      <div className="pointer-events-none absolute top-2.5 inset-x-0 text-center">
        <span className="inline-block font-pixel text-[10px] tracking-wide rounded-lg px-3 py-2"
          style={{ color: yourTurn ? '#e3d2ff' : 'rgba(255,255,255,0.85)', background: 'rgba(10,6,32,0.75)', border: `1px solid ${yourTurn ? accent : 'rgba(255,255,255,0.14)'}` }}>
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
            <span className="inline-block font-pixel text-[9px] tracking-wide rounded-lg px-3 py-2"
              style={{ color: '#ffffff', background: 'rgba(10,6,32,0.85)', border: '1px solid rgba(255,255,255,0.35)' }}>
              {describeCard(card).toUpperCase()} — ENTER TO {phase === 'penalty' ? 'STACK' : 'PLAY'}
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
