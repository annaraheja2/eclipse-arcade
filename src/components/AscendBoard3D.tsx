// Ascend's 3D presentation: a smooth neon-on-dark 10×10 board, ladder and
// snake geometry, three hopping racers, and a low follow-cam that rides
// behind-and-above whoever is rolling. No rules live here — the page owns
// state; this component animates a `move` it is handed and reports back via
// `onMoveDone`.

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3, Color as ThreeColor, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, TubeGeometry, Vector3,
} from 'three'
import type { Group } from 'three'
import Character3D, { SEAT_TINTS } from './Character3D'
import {
  BOARD_N, LADDERS, SNAKES, LAST_SQUARE, TILE, squareToWorld, START_SQUARE,
  type Chute,
} from '../lib/ascend'

/** One resolved hop, handed down by the page. `seq` de-dupes completion. */
export interface BoardMove {
  seq: number
  racer: number
  from: number
  path: number[]
  chute: Chute | null
}

const NIGHT = '#0a0620'
const TILE_A = '#1d1342'
const TILE_B = '#271a55'
const LADDER_NEON = '#3dffa2'
const SNAKE_NEON = '#ff4d8d'

const HOP_SECS = 0.34 // per square of the hop
const HOP_HEIGHT = 0.55
const CHUTE_SECS = 0.85 // the ladder climb / snake slide
const CAM_EASE = 2.6 // 1/s

// Small per-seat offsets so racers sharing a square never merge.
const SEAT_OFFSET: readonly (readonly [number, number])[] = [[0, 0.1], [-0.26, -0.16], [0.26, -0.16]]

const UP = new Vector3(0, 1, 0)

// ---- decorative geometry (built once per mount) ------------------------------

interface Rod { pos: [number, number, number]; quat: Quaternion; len: number }

/** Rails + rungs for one ladder, rising from its base square to its top. */
function ladderRods(base: number, top: number): { rails: Rod[]; rungs: Rod[] } {
  const w0 = squareToWorld(base)
  const w1 = squareToWorld(top)
  const a = new Vector3(w0.x, 0.16, w0.z)
  const b = new Vector3(w1.x, 0.95, w1.z)
  const dir = b.clone().sub(a)
  const len = dir.length()
  dir.normalize()
  const quat = new Quaternion().setFromUnitVectors(UP, dir)
  const side = new Vector3().crossVectors(dir, UP).normalize()
  const sideQuat = new Quaternion().setFromUnitVectors(UP, side)
  const rails: Rod[] = [-1, 1].map((s) => {
    const mid = a.clone().add(b).multiplyScalar(0.5).addScaledVector(side, s * 0.17)
    return { pos: [mid.x, mid.y, mid.z], quat, len }
  })
  const count = Math.max(2, Math.round(len / 0.55))
  const rungs: Rod[] = Array.from({ length: count }, (_, i) => {
    const p = a.clone().lerp(b, (i + 0.5) / count)
    return { pos: [p.x, p.y, p.z], quat: sideQuat, len: 0.4 }
  })
  return { rails, rungs }
}

/** A snake body: a gentle S-curve tube from its head square to its tail. */
function snakeTube(head: number, tail: number): { geo: TubeGeometry; headPos: [number, number, number] } {
  const w0 = squareToWorld(head)
  const w1 = squareToWorld(tail)
  const a = new Vector3(w0.x, 0.2, w0.z)
  const b = new Vector3(w1.x, 0.2, w1.z)
  const dir = b.clone().sub(a).normalize()
  const side = new Vector3().crossVectors(dir, UP).normalize()
  const m1 = a.clone().lerp(b, 0.33).addScaledVector(side, 0.45)
  const m2 = a.clone().lerp(b, 0.66).addScaledVector(side, -0.45)
  const curve = new CatmullRomCurve3([a, m1, m2, b])
  return { geo: new TubeGeometry(curve, 32, 0.09, 8), headPos: [a.x, a.y, a.z] }
}

// ---- the scene ---------------------------------------------------------------

// Per-frame scratch vectors — never allocated in the loop.
const MOVER = new Vector3()
const SEG_A = new Vector3()
const SEG_B = new Vector3()
const CAM_TARGET = new Vector3()
const CAM_LOOK = new Vector3()

function worldOf(sq: number, out: Vector3): Vector3 {
  const { x, z } = squareToWorld(sq)
  return out.set(x, 0.12, z)
}

function Scene({ positions, activeRacer, move, onMoveDone, reduced }: {
  positions: readonly number[]
  activeRacer: number
  move: BoardMove | null
  onMoveDone: (seq: number) => void
  reduced: boolean
}) {
  const racerRefs = useRef<(Group | null)[]>([])
  const doneRef = useRef(0) // last seq reported done
  const clockRef = useRef(0) // seconds into the current move
  const onDoneRef = useRef(onMoveDone)
  onDoneRef.current = onMoveDone

  // Reset the move clock when a new move arrives; under reduced motion the
  // whole animation is skipped and the move completes immediately.
  useEffect(() => {
    if (!move || move.seq <= doneRef.current) return
    clockRef.current = 0
    if (reduced) {
      doneRef.current = move.seq
      onDoneRef.current(move.seq)
    }
  }, [move, reduced])

  // Shared materials/geometry for the tile field + chutes.
  const mats = useMemo(() => ({
    tileA: new MeshStandardMaterial({ color: TILE_A, roughness: 0.6 }),
    tileB: new MeshStandardMaterial({ color: TILE_B, roughness: 0.6 }),
    ladder: new MeshStandardMaterial({
      color: LADDER_NEON, emissive: new ThreeColor(LADDER_NEON), emissiveIntensity: 0.55, roughness: 0.35,
    }),
    snake: new MeshStandardMaterial({
      color: SNAKE_NEON, emissive: new ThreeColor(SNAKE_NEON), emissiveIntensity: 0.45, roughness: 0.4,
    }),
    ringFinish: new MeshBasicMaterial({ color: LADDER_NEON, transparent: true, opacity: 0.85, toneMapped: false }),
    puck: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, toneMapped: false }),
  }), [])
  const ladders = useMemo(() => Object.entries(LADDERS).map(([b, t]) => ladderRods(Number(b), t)), [])
  const snakes = useMemo(() => Object.entries(SNAKES).map(([h, t]) => snakeTube(Number(h), t)), [])
  useEffect(() => () => {
    for (const m of Object.values(mats)) m.dispose()
    for (const s of snakes) s.geo.dispose()
  }, [mats, snakes])

  const tiles = useMemo(() => Array.from({ length: LAST_SQUARE }, (_, i) => {
    const sq = i + 1
    const { x, z } = squareToWorld(sq)
    return { sq, x, z, alt: (Math.floor(i / BOARD_N) + i) % 2 === 1 }
  }), [])

  useFrame(({ camera }, dt) => {
    const m = move && move.seq > doneRef.current ? move : null
    const hopTotal = m ? m.path.length * HOP_SECS : 0
    const total = m ? hopTotal + (m.chute ? CHUTE_SECS : 0) : 0
    if (m) clockRef.current = Math.min(clockRef.current + dt, total)
    const t = clockRef.current

    // Place every racer; the mover follows its hop path (arcing square to
    // square), then rides its chute (ladder climb / snake slide).
    positions.forEach((sq, seat) => {
      const g = racerRefs.current[seat]
      if (!g) return
      if (m && seat === m.racer) {
        if (t < hopTotal) {
          const seg = Math.min(m.path.length - 1, Math.floor(t / HOP_SECS))
          const local = t / HOP_SECS - seg
          worldOf(seg === 0 ? m.from : m.path[seg - 1], SEG_A)
          worldOf(m.path[seg], SEG_B)
          MOVER.lerpVectors(SEG_A, SEG_B, local)
          MOVER.y += Math.sin(Math.PI * local) * HOP_HEIGHT
        } else if (m.chute) {
          const local = Math.min(1, (t - hopTotal) / CHUTE_SECS)
          worldOf(m.chute.from, SEG_A)
          worldOf(m.chute.to, SEG_B)
          MOVER.lerpVectors(SEG_A, SEG_B, local)
          MOVER.y += Math.sin(Math.PI * local) * (m.chute.kind === 'ladder' ? 0.75 : 0.25)
        } else {
          worldOf(m.path[m.path.length - 1], MOVER)
        }
        g.position.copy(MOVER)
        if (t >= total) {
          doneRef.current = m.seq
          onDoneRef.current(m.seq)
        }
      } else {
        worldOf(sq, MOVER)
        const [ox, oz] = SEAT_OFFSET[seat % SEAT_OFFSET.length]
        g.position.set(MOVER.x + ox, MOVER.y, MOVER.z + oz)
      }
    })

    // Follow-cam: low, behind-and-above the ACTIVE racer, turning toward
    // whoever is rolling. Eased glide; snaps under reduced motion.
    const focus = racerRefs.current[activeRacer]
    if (focus) {
      CAM_TARGET.set(focus.position.x * 0.72, 3.4, focus.position.z + 5.4)
      CAM_LOOK.set(focus.position.x, 0.9, focus.position.z - 1.4)
      if (reduced) {
        camera.position.copy(CAM_TARGET)
        camera.lookAt(CAM_LOOK)
      } else {
        const ease = 1 - Math.exp(-CAM_EASE * Math.min(dt, 0.05))
        camera.position.lerp(CAM_TARGET, ease)
        camera.lookAt(CAM_LOOK)
      }
    }
  })

  const start = squareToWorld(START_SQUARE)
  const finish = squareToWorld(LAST_SQUARE)
  const span = BOARD_N * TILE

  return (
    <>
      <color attach="background" args={[NIGHT]} />
      <fog attach="fog" args={[NIGHT, 16, 42]} />
      <hemisphereLight args={['#8a6fd8', '#140b33', 0.9]} />
      <directionalLight position={[6, 10, 6]} intensity={1.4} color="#cfd8ff" />
      <pointLight position={[finish.x, 3, finish.z]} intensity={22} color={LADDER_NEON} distance={9} decay={2} />
      <pointLight position={[start.x, 2.5, start.z]} intensity={14} color="#a24bff" distance={8} decay={2} />

      {/* base slab under the tile field */}
      <mesh position={[0, -0.26, 0]}>
        <boxGeometry args={[span + 1.2, 0.3, span + 1.2]} />
        <meshStandardMaterial color="#120a2c" roughness={0.85} />
      </mesh>
      {/* the 100 tiles, alternating like a smooth night checkerboard */}
      {tiles.map((tl) => (
        <mesh key={tl.sq} position={[tl.x, 0, tl.z]} material={tl.alt ? mats.tileB : mats.tileA}>
          <boxGeometry args={[TILE * 0.94, 0.22, TILE * 0.94]} />
        </mesh>
      ))}
      {/* the start pad */}
      <mesh position={[start.x, -0.02, start.z]} material={mats.tileB}>
        <cylinderGeometry args={[TILE * 0.48, TILE * 0.52, 0.18, 24]} />
      </mesh>
      {/* the summit ring on 100 */}
      <mesh position={[finish.x, 0.13, finish.z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.ringFinish}>
        <ringGeometry args={[0.36, 0.5, 32]} />
      </mesh>

      {/* ladders: twin neon rails + rungs from base to top */}
      {ladders.map((l, i) => (
        <group key={`l${i}`}>
          {l.rails.map((r, j) => (
            <mesh key={j} position={r.pos} quaternion={r.quat} material={mats.ladder}>
              <cylinderGeometry args={[0.05, 0.05, r.len, 8]} />
            </mesh>
          ))}
          {l.rungs.map((r, j) => (
            <mesh key={`r${j}`} position={r.pos} quaternion={r.quat} material={mats.ladder}>
              <cylinderGeometry args={[0.035, 0.035, r.len, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* snakes: glowing S-curve tubes, a bulb for the head */}
      {snakes.map((s, i) => (
        <group key={`s${i}`}>
          <mesh geometry={s.geo} material={mats.snake} />
          <mesh position={s.headPos} material={mats.snake}>
            <sphereGeometry args={[0.16, 12, 10]} />
          </mesh>
        </group>
      ))}

      {/* the three racers */}
      {positions.map((_, seat) => (
        <group key={seat} ref={(g) => { racerRefs.current[seat] = g }}>
          <group scale={0.52}>
            <Character3D tint={SEAT_TINTS[seat % SEAT_TINTS.length]} dimmed={seat !== activeRacer} dimColor="#241a44" />
          </group>
          {seat === activeRacer && (
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.puck}>
              <circleGeometry args={[0.42, 24]} />
            </mesh>
          )}
        </group>
      ))}
    </>
  )
}

export default function AscendBoard3D(props: {
  positions: readonly number[]
  activeRacer: number
  move: BoardMove | null
  onMoveDone: (seq: number) => void
  reduced: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-[#0a0620]">
      <div className="h-[340px] sm:h-[420px]">
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: 52, near: 0.1, far: 80, position: [0, 6, 12] }}
          aria-label="3D Ascend board"
          role="img"
        >
          <Scene {...props} />
        </Canvas>
      </div>
    </div>
  )
}
