// The Last Standing 3D table — presentation only, no rules. The table stands
// on a beach at sunset (BeachWorld): the sun drowning on the waterline, surf
// running up wet sand, palms leaning in and paper lanterns drifting over the
// water. The dark accent-ringed felt catches the rose-gold key light. The shared
// Character3D figures sit on five FIXED seats (nobody shuffles when a player
// leaves), and the camera turns toward whoever is answering. Eliminated seats
// dim; a banished character sinks below the ground and their seat light dies —
// snapped instantly under reduced motion. Lives + the live countdown render on
// each seat's label plane (and accessibly in the page DOM — the canvas is
// decorative).
//
// Mirrors CardTable3D's remaining patterns (seat placement, canvas-texture
// labels, eased camera rig) rather than extracting them — deliberate
// duplication until a third table earns the abstraction.

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ACESFilmicToneMapping, CanvasTexture, MeshBasicMaterial, SRGBColorSpace, Vector3 } from 'three'
import type { Group } from 'three'
import { BeachWorld, BeachLights, BEACH_FOG } from './BeachWorld'
import Character3D, { SEAT_TINTS } from './Character3D'
import { LIVES, isAlive, type LsState, type Seat } from '../lib/laststanding'

const FELT = '#1c1140'
const RIM = '#2b1a5e'
const DIM = '#241b38' // what dimmed figures sink toward on the neon floor
const TABLE_R = 3.4
const SEAT_R = 4.5
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

/** Seat i of SEAT_COUNT around the table; seat 0 (you) at +z, camera side. */
function seatPosition(i: number, n: number): { x: number; z: number } {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n
  return { x: Math.cos(angle) * SEAT_R, z: Math.sin(angle) * SEAT_R }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A one-off canvas-text material, rebaked only when `key` changes. */
function useLabelMaterial(draw: (ctx: CanvasRenderingContext2D) => void, key: string): MeshBasicMaterial {
  const mat = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (ctx) draw(ctx)
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 4
    return new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
    // `key` encodes everything the drawing reads — redraw only when it changes.
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { mat.map?.dispose(); mat.dispose() }, [mat])
  return mat
}

// ---- one seat ------------------------------------------------------------

function PlayerSeat({ seat, total, active, accent, reduced, secondsLeft }: {
  seat: Seat
  total: number
  active: boolean
  accent: string
  reduced: boolean
  secondsLeft: number | null // shown on the active seat's label
}) {
  const { x, z } = seatPosition(seat.seat, total)
  const yaw = Math.atan2(-x, -z) // local +z faces the table centre
  const alive = isAlive(seat)
  const groupRef = useRef<Group>(null)
  const puckRef = useRef<Group>(null)

  // Banish beat: the whole seat sinks + shrinks away. Reduced motion snaps.
  useFrame(({ clock }, dt) => {
    const g = groupRef.current
    if (g) {
      const target = seat.inLobby ? 1 : 0
      if (reduced) g.scale.setScalar(target)
      else {
        const s = g.scale.x + (target - g.scale.x) * Math.min(1, dt * 3.5)
        g.scale.setScalar(s)
      }
      g.position.y = -2.6 * (1 - g.scale.x) // sink as it shrinks
      g.visible = g.scale.x > 0.01
    }
    const puck = puckRef.current
    if (puck && !reduced) puck.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2.6) * 0.08)
  })

  const timer = active && secondsLeft !== null ? secondsLeft : null
  const labelKey = `${seat.name}|${seat.lives}|${seat.inLobby}|${alive}|${active}|${timer ?? ''}`
  const labelMat = useLabelMaterial((ctx) => {
    ctx.font = `600 44px ${SANS}`
    const text = timer !== null ? `${seat.name} · ${timer}s` : seat.name
    const tw = ctx.measureText(text).width
    const pipsW = LIVES * 34
    const w = Math.max(tw, pipsW) + 56
    roundedRect(ctx, 256 - w / 2, 8, w, 128, 24)
    ctx.fillStyle = 'rgba(10,6,32,0.85)'
    ctx.fill()
    if (active) {
      ctx.lineWidth = 6
      ctx.strokeStyle = accent
      roundedRect(ctx, 256 - w / 2, 8, w, 128, 24)
      ctx.stroke()
    }
    ctx.fillStyle = alive ? '#ffffff' : 'rgba(255,255,255,0.45)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 48)
    // life pips: filled = a life left, hollow = spent
    for (let i = 0; i < LIVES; i++) {
      const px = 256 - ((LIVES - 1) * 34) / 2 + i * 34
      ctx.beginPath()
      ctx.arc(px, 100, 11, 0, Math.PI * 2)
      if (i < seat.lives) { ctx.fillStyle = accent; ctx.fill() }
      else { ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke() }
    }
  }, labelKey)

  return (
    <group ref={groupRef} position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* stool */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.38, 0.46, 0.44, 12]} />
        <meshStandardMaterial color={RIM} roughness={0.8} />
      </mesh>
      <group position={[0, 0.44, 0]}>
        <Character3D tint={SEAT_TINTS[seat.seat % SEAT_TINTS.length]} dimmed={!active || !alive} dimColor={DIM} />
      </group>
      {/* name · timer + life pips, counter-yawed upright toward the camera */}
      <mesh position={[0, 3.35, 0]} rotation={[0, -yaw, 0]}>
        <planeGeometry args={[2.9, 0.9]} />
        <primitive object={labelMat} attach="material" />
      </mesh>
      {/* dark shroud puck under an eliminated (but not banished) seat */}
      {!alive && seat.inLobby && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.9, 24]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.5} />
        </mesh>
      )}
      {/* active-turn glow */}
      {active && (
        <>
          <group ref={puckRef}>
            <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.95, 24]} />
              <meshBasicMaterial color={accent} transparent opacity={0.4} toneMapped={false} />
            </mesh>
          </group>
          <pointLight position={[0, 3.4, 0.7]} intensity={12} color={accent} distance={7} decay={2} />
        </>
      )}
    </group>
  )
}

// ---- camera rig ----------------------------------------------------------
// Behind your seat, easing its gaze toward the ACTIVE answerer; pulls to the
// table centre for banish/champion beats. Reduced motion snaps.

const CAM_POS: readonly [number, number, number] = [0, 6.4, 10.6]
const LOOK_CENTRE: readonly [number, number, number] = [0, 1.2, 0]
const CAM_EASE = 3.0
const LOOK_SCRATCH = new Vector3()

function CameraRig({ state, reduced }: { state: LsState; reduced: boolean }) {
  const lookCur = useRef(new Vector3(...LOOK_CENTRE)).current

  if (state.phase.kind === 'turn') {
    const { x, z } = seatPosition(state.turn, state.seats.length)
    LOOK_SCRATCH.set(x * 0.75, 1.5, z * 0.75)
  } else {
    LOOK_SCRATCH.set(...LOOK_CENTRE)
  }

  useFrame(({ camera }, dt) => {
    camera.position.set(...CAM_POS)
    if (reduced) lookCur.copy(LOOK_SCRATCH)
    else lookCur.lerp(LOOK_SCRATCH, 1 - Math.exp(-CAM_EASE * Math.min(dt, 0.05)))
    camera.lookAt(lookCur)
  })
  return null
}

// ---- the arena -----------------------------------------------------------

function Arena({ accent }: { accent: string }) {
  return (
    <group>
      {/* no floor disc — BeachWorld's sand is the ground the table sits on */}
      {/* table: felt top, accent rim, pedestal */}
      <mesh position={[0, 0.95, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.22, 48]} />
        <meshStandardMaterial color={FELT} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_R, 0.11, 12, 64]} />
        <meshStandardMaterial color={RIM} roughness={0.4} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.7, 1.4, 0.95, 24]} />
        <meshStandardMaterial color="#180f38" roughness={1} />
      </mesh>
      {/* accent ring inlaid on the felt */}
      <mesh position={[0, 1.065, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.7, 1.78, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Scene({ state, accent, reduced, secondsLeft }: {
  state: LsState
  accent: string
  reduced: boolean
  secondsLeft: number | null
}) {
  const activeSeat = state.phase.kind === 'turn' ? state.turn : -1
  return (
    <>
      <fog attach="fog" args={BEACH_FOG} />
      <BeachLights />
      {/* the cabinet's own neon still pools over the table, so the accent reads
          as the game's colour even against the warm key light */}
      <pointLight position={[0, 5.5, 0]} intensity={9} color={accent} distance={14} decay={2} />
      {/* groundY 0.22 puts the sand (drawn at groundY − 0.22) exactly at y = 0,
          where the stools and the table pedestal stand */}
      <BeachWorld reduced={reduced} groundY={0.22} />
      <Arena accent={accent} />
      {state.seats.map((seat) => (
        <PlayerSeat key={seat.seat} seat={seat} total={state.seats.length}
          active={seat.seat === activeSeat} accent={accent} reduced={reduced}
          secondsLeft={secondsLeft} />
      ))}
      <CameraRig state={state} reduced={reduced} />
    </>
  )
}

// ---- component -----------------------------------------------------------

export default function LastStandingTable3D({ state, accent, reduced, secondsLeft }: {
  state: LsState
  accent: string
  reduced: boolean
  secondsLeft: number | null // the active player's ticking countdown
}) {
  return (
    <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-[#3a2450]">
      <div className="h-[340px] sm:h-[420px]">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
          camera={{ fov: 50, near: 0.1, far: 500, position: [0, 6.4, 10.6] }}
          aria-label="3D elimination table"
          role="img"
        >
          <Scene state={state} accent={accent} reduced={reduced} secondsLeft={secondsLeft} />
        </Canvas>
      </div>
    </div>
  )
}
