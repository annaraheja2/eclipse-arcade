// Ascend's 3D presentation: a vintage snakes-and-ladders board lying flat on a
// warm wooden table, hand-placed 3D wooden ladders and painterly snakes at the
// REAL chute positions, three hopping racers, and a Roblox-style chase camera
// that rides behind-and-above whoever is rolling, looking down their path.
// No rules live here — the page owns state; this component animates a `move`
// it is handed and reports back via `onMoveDone`.

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  BufferAttribute, CanvasTexture, CatmullRomCurve3, MeshBasicMaterial,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Texture,
  TextureLoader, TubeGeometry, Vector3,
} from 'three'
import type { Group } from 'three'
import Character3D, { SEAT_TINTS } from './Character3D'
import {
  BOARD_N, LADDERS, SNAKES, LAST_SQUARE, TILE, squareToWorld, START_SQUARE,
  type Chute,
} from '../lib/ascend'
import {
  BOARD_PX, GRID_PX, hash01, paintAscendBoardFace,
} from '../lib/ascendBoardTexture'

/** One resolved hop, handed down by the page. `seq` de-dupes completion. */
export interface BoardMove {
  seq: number
  racer: number
  from: number
  path: number[]
  chute: Chute | null
}

// ---- BOARD FACE ART — THE SWAP SEAM ------------------------------------------
// The board face (patchwork tiles + numerals + ornate frame — NO snakes or
// ladders, those are live 3D so gameplay always matches the art) comes from
// this ONE source. By default it's painted procedurally by
// `lib/ascendBoardTexture.ts`.
//
// To use your own picture instead: drop a square image into `public/` (e.g.
// `public/ascend-board.png`) and change the line below to
//   const BOARD_FACE_URL: string | null = './ascend-board.png'
// Image contract: square; bottom-left tile is 1, top-left is "100 FINISH"
// (classic boustrophedon); the 10×10 grid inset from every edge by ~7.7% of
// the image width for the frame (see FRAME_FRACTION in ascendBoardTexture).
const BOARD_FACE_URL: string | null = null
// ------------------------------------------------------------------------------

const ROOM = '#241309' // the warm room tone behind the table
const TABLE_WOOD = '#3a2314'
const BOARD_EDGE = '#452a15'
const GOLD = '#d9b45c'

const HOP_SECS = 0.34 // per square of the hop
const HOP_HEIGHT = 0.55
const CHUTE_SECS = 0.85 // the ladder climb / snake slide

// Chase cam: behind-and-above the active racer, looking down its path.
const CHASE_BACK = 4.0
const CHASE_UP = 3.3
const LOOK_AHEAD = 3.0
const CAM_EASE = 3.2 // 1/s — position glide
const CAM_TURN = 2.2 // 1/s — how fast the chase direction swings
const YAW_EASE = 9 // 1/s — how fast a figure turns to face travel

// Small per-seat offsets so racers sharing a square never merge.
const SEAT_OFFSET: readonly (readonly [number, number])[] = [[0, 0.1], [-0.26, -0.16], [0.26, -0.16]]

const UP = new Vector3(0, 1, 0)

// ---- decorative geometry (built once per mount) ------------------------------

interface Rod { pos: [number, number, number]; quat: Quaternion; len: number }
interface LadderBuild { rails: Rod[]; rungs: Rod[]; railR: number; rungR: number; wood: string }

/** Mix two hex wood tones — per-ladder timber variation. */
function woodTone(t: number): string {
  const a = [0x7a, 0x4a, 0x22]
  const b = [0xa8, 0x76, 0x3e]
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Rails + rungs for one ladder — endpoints anchored to its squares but each
 *  one leans and sizes a little differently, like it was propped by hand. */
function ladderBuild(base: number, top: number): LadderBuild {
  const seed = base * 101 + top
  const w0 = squareToWorld(base)
  const w1 = squareToWorld(top)
  const a = new Vector3(w0.x, 0.14, w0.z)
  const b = new Vector3(w1.x, 0.75 + 0.55 * hash01(seed, 3), w1.z)
  // wonky: nudge each end sideways off the grid line
  const flat = new Vector3(b.x - a.x, 0, b.z - a.z).normalize()
  const sideFlat = new Vector3().crossVectors(flat, UP).normalize()
  a.addScaledVector(sideFlat, (hash01(seed, 1) - 0.5) * 0.3)
  b.addScaledVector(sideFlat, (hash01(seed, 2) - 0.5) * 0.5)
  const dir = b.clone().sub(a)
  const len = dir.length()
  dir.normalize()
  const quat = new Quaternion().setFromUnitVectors(UP, dir)
  const side = new Vector3().crossVectors(dir, UP).normalize()
  const sideQuat = new Quaternion().setFromUnitVectors(UP, side)
  const sep = 0.15 + 0.06 * hash01(seed, 5)
  const railR = 0.04 + 0.025 * hash01(seed, 4)
  const rails: Rod[] = [-1, 1].map((s) => {
    const mid = a.clone().add(b).multiplyScalar(0.5).addScaledVector(side, s * sep)
    return { pos: [mid.x, mid.y, mid.z], quat, len }
  })
  const count = Math.max(2, Math.round(len / 0.5))
  const rungs: Rod[] = Array.from({ length: count }, (_, i) => {
    const p = a.clone().lerp(b, (i + 0.5) / count)
    return { pos: [p.x, p.y, p.z], quat: sideQuat, len: sep * 2 + railR * 2 }
  })
  return { rails, rungs, railR, rungR: railR * 0.7, wood: woodTone(hash01(seed, 6)) }
}

// Painted-snake skins from the reference board: green, ochre, red, blue.
const SNAKE_SKINS: readonly { base: string; band: string }[] = [
  { base: '#4e6b2f', band: '#2c4218' },
  { base: '#c8992e', band: '#8a621a' },
  { base: '#a93b2a', band: '#67231a' },
  { base: '#3f6b8a', band: '#274a63' },
]

/** Banded skin texture: base color with dark cross-bands repeated along the body. */
function snakeSkinTexture(base: string, band: string, repeats: number): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 32
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 96, 32)
    ctx.fillStyle = band
    ctx.fillRect(30, 0, 14, 32)
    ctx.fillRect(72, 0, 10, 32)
    ctx.fillStyle = 'rgba(255, 240, 200, 0.22)' // pale belly stripe
    ctx.fillRect(0, 0, 96, 5)
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.repeat.set(repeats, 1)
  return tex
}

interface SnakeBuild {
  geo: TubeGeometry
  tex: CanvasTexture
  rHead: number
  head: { pos: [number, number, number]; yaw: number }
}

/** A wandering S-curve from head square to tail. Ends stay anchored to the
 *  real squares; the middle bends, and each snake gets its own girth. */
function snakeBuild(head: number, tail: number): SnakeBuild {
  const seed = head * 131 + tail
  const w0 = squareToWorld(head)
  const w1 = squareToWorld(tail)
  const a = new Vector3(w0.x, 0.16, w0.z)
  const b = new Vector3(w1.x, 0.12, w1.z)
  const dir = b.clone().sub(a)
  const len = dir.length()
  dir.normalize()
  const side = new Vector3().crossVectors(dir, UP).normalize()
  const bends = 2 + Math.floor(hash01(seed, 1) * 2)
  const amp = 0.35 + hash01(seed, 2) * 0.5
  const pts = [a]
  for (let k = 1; k <= bends; k++) {
    const p = a.clone().lerp(b, k / (bends + 1))
    p.addScaledVector(side, amp * (k % 2 === 0 ? -1 : 1) * (0.7 + 0.6 * hash01(seed, 3 + k)))
    p.addScaledVector(dir, (hash01(seed, 8 + k) - 0.5) * 0.35)
    p.y = 0.1 + 0.1 * hash01(seed, 12 + k)
    pts.push(p)
  }
  pts.push(b)
  const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.6)
  // girth: hash-varied, longer snakes trend thicker — some big, some small
  const rHead = (0.08 + 0.07 * hash01(seed, 20)) * Math.min(1.25, Math.max(0.8, 0.72 + len / 18))
  const geo = taperedTube(curve, rHead, rHead * 0.25)
  const skin = SNAKE_SKINS[Math.floor(hash01(seed, 30) * SNAKE_SKINS.length)]
  const tex = snakeSkinTexture(skin.base, skin.band, Math.max(3, Math.round(len / 0.6)))
  const tan = curve.getTangentAt(0)
  const yaw = Math.atan2(-tan.x, -tan.z) // the head looks away from the body
  const hp = a.clone().addScaledVector(new Vector3(tan.x, 0, tan.z).normalize(), -rHead * 1.1)
  hp.y = a.y + rHead * 0.25
  return { geo, tex, rHead, head: { pos: [hp.x, hp.y, hp.z], yaw } }
}

/** TubeGeometry with a radius that tapers head → tail (with a slight body
 *  bulge): built at radius 1, then each ring is scaled about its own centre. */
function taperedTube(curve: CatmullRomCurve3, rHead: number, rTail: number): TubeGeometry {
  const segs = 72
  const radial = 10
  const geo = new TubeGeometry(curve, segs, 1, radial, false)
  const pos = geo.attributes.position as BufferAttribute
  const ring = radial + 1 // last radial vertex duplicates the first
  const center = new Vector3()
  const v = new Vector3()
  for (let i = 0; i <= segs; i++) {
    center.set(0, 0, 0)
    for (let j = 0; j < radial; j++) center.add(v.fromBufferAttribute(pos, i * ring + j))
    center.multiplyScalar(1 / radial)
    const t = i / segs
    const r = (rHead * (1 - t) + rTail * t) * (0.92 + 0.18 * Math.sin(Math.PI * Math.min(1, t * 1.2)))
    for (let j = 0; j < ring; j++) {
      const k = i * ring + j
      v.fromBufferAttribute(pos, k).sub(center).multiplyScalar(r).add(center)
      pos.setXYZ(k, v.x, v.y, v.z)
    }
  }
  geo.computeVertexNormals()
  return geo
}

// ---- the scene ---------------------------------------------------------------

// Per-frame scratch vectors — never allocated in the loop.
const MOVER = new Vector3()
const SEG_A = new Vector3()
const SEG_B = new Vector3()
const FWD = new Vector3()
const ACT_FWD = new Vector3()
const CAM_TARGET = new Vector3()
const CAM_LOOK = new Vector3()

function worldOf(sq: number, out: Vector3): Vector3 {
  const { x, z } = squareToWorld(sq)
  return out.set(x, 0.12, z)
}

/** Direction of travel at a square: toward the next square along the path. */
function travelDirOf(sq: number, out: Vector3): Vector3 {
  const s = Math.min(Math.max(sq, START_SQUARE), LAST_SQUARE - 1)
  const a = squareToWorld(s)
  const b = squareToWorld(s + 1)
  return out.set(b.x - a.x, 0, b.z - a.z).normalize()
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
  const yawsRef = useRef<number[]>([]) // smoothed facing per seat
  const camFwdRef = useRef(new Vector3(1, 0, 0)) // smoothed chase direction

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

  // The board face texture — user image if configured, else the vintage painter.
  const faceTex = useMemo<Texture>(() => {
    if (BOARD_FACE_URL !== null) {
      const t = new TextureLoader().load(BOARD_FACE_URL)
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 8
      return t
    }
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = BOARD_PX
    const ctx = canvas.getContext('2d')
    if (ctx) paintAscendBoardFace(ctx)
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])

  const mats = useMemo(() => ({
    face: new MeshStandardMaterial({ map: faceTex, roughness: 0.82 }),
    boardEdge: new MeshStandardMaterial({ color: BOARD_EDGE, roughness: 0.75 }),
    table: new MeshStandardMaterial({ color: TABLE_WOOD, roughness: 0.92 }),
    startPad: new MeshStandardMaterial({ color: '#6b4423', roughness: 0.7 }),
    goldRing: new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }),
    shadowBlob: new MeshBasicMaterial({ color: '#120a04', transparent: true, opacity: 0.28 }),
    darkDetail: new MeshStandardMaterial({ color: '#1d1408', roughness: 0.4 }),
    tongue: new MeshStandardMaterial({ color: '#a32c1c', roughness: 0.5 }),
  }), [faceTex])
  const ladders = useMemo(() => Object.entries(LADDERS).map(([b, t]) => ladderBuild(Number(b), t)), [])
  const ladderMats = useMemo(() => ladders.map((l) => ({
    rail: new MeshStandardMaterial({ color: l.wood, roughness: 0.8 }),
    rung: new MeshStandardMaterial({ color: woodTone(0.2), roughness: 0.85 }),
  })), [ladders])
  const snakes = useMemo(() => Object.entries(SNAKES).map(([h, t]) => snakeBuild(Number(h), t)), [])
  const snakeMats = useMemo(
    () => snakes.map((s) => new MeshStandardMaterial({ map: s.tex, roughness: 0.55 })),
    [snakes],
  )
  useEffect(() => () => {
    faceTex.dispose()
    for (const m of Object.values(mats)) m.dispose()
    for (const lm of ladderMats) { lm.rail.dispose(); lm.rung.dispose() }
    for (const s of snakes) { s.geo.dispose(); s.tex.dispose() }
    for (const m of snakeMats) m.dispose()
  }, [faceTex, mats, ladderMats, snakes, snakeMats])

  useFrame(({ camera }, dt) => {
    const m = move && move.seq > doneRef.current ? move : null
    const hopTotal = m ? m.path.length * HOP_SECS : 0
    const total = m ? hopTotal + (m.chute ? CHUTE_SECS : 0) : 0
    if (m) clockRef.current = Math.min(clockRef.current + dt, total)
    const t = clockRef.current

    ACT_FWD.copy(camFwdRef.current)

    // Place and orient every racer; the mover follows its hop path (arcing
    // square to square), then rides its chute (ladder climb / snake slide).
    // Each figure faces its direction of travel.
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
          FWD.subVectors(SEG_B, SEG_A).setY(0)
        } else if (m.chute) {
          const local = Math.min(1, (t - hopTotal) / CHUTE_SECS)
          worldOf(m.chute.from, SEG_A)
          worldOf(m.chute.to, SEG_B)
          MOVER.lerpVectors(SEG_A, SEG_B, local)
          MOVER.y += Math.sin(Math.PI * local) * (m.chute.kind === 'ladder' ? 0.75 : 0.25)
          FWD.subVectors(SEG_B, SEG_A).setY(0)
        } else {
          worldOf(m.path[m.path.length - 1], MOVER)
          travelDirOf(m.path[m.path.length - 1], FWD)
        }
        if (FWD.lengthSq() < 1e-6) travelDirOf(sq, FWD)
        else FWD.normalize()
        g.position.copy(MOVER)
        if (t >= total) {
          doneRef.current = m.seq
          onDoneRef.current(m.seq)
        }
      } else {
        worldOf(sq, MOVER)
        const [ox, oz] = SEAT_OFFSET[seat % SEAT_OFFSET.length]
        g.position.set(MOVER.x + ox, MOVER.y, MOVER.z + oz)
        travelDirOf(sq, FWD)
      }
      // shortest-arc turn toward the travel direction
      const targetYaw = Math.atan2(FWD.x, FWD.z)
      const cur = yawsRef.current[seat] ?? targetYaw
      const d = ((targetYaw - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      const yaw = reduced ? targetYaw : cur + d * Math.min(1, YAW_EASE * dt)
      yawsRef.current[seat] = yaw
      g.rotation.y = yaw
      if (seat === activeRacer) ACT_FWD.copy(FWD)
    })

    // Roblox-style chase cam: behind-and-above the ACTIVE racer, looking
    // ahead along its direction of travel. Eased glide + eased swing; snaps
    // under reduced motion.
    const focus = racerRefs.current[activeRacer]
    if (focus) {
      const turnEase = reduced ? 1 : 1 - Math.exp(-CAM_TURN * Math.min(dt, 0.05))
      camFwdRef.current.lerp(ACT_FWD, turnEase)
      if (camFwdRef.current.lengthSq() < 0.001) camFwdRef.current.copy(ACT_FWD)
      camFwdRef.current.normalize()
      const f = camFwdRef.current
      CAM_TARGET.copy(focus.position).addScaledVector(f, -CHASE_BACK)
      CAM_TARGET.y = focus.position.y + CHASE_UP
      if (reduced) camera.position.copy(CAM_TARGET)
      else camera.position.lerp(CAM_TARGET, 1 - Math.exp(-CAM_EASE * Math.min(dt, 0.05)))
      CAM_LOOK.copy(focus.position).addScaledVector(f, LOOK_AHEAD)
      // bias the gaze slightly toward the board centre so edge rows don't
      // leave half the frame on empty table
      CAM_LOOK.x -= focus.position.x * 0.16
      CAM_LOOK.z -= focus.position.z * 0.16
      CAM_LOOK.y = 0.15
      camera.lookAt(CAM_LOOK)
    }
  })

  const start = squareToWorld(START_SQUARE)
  const span = BOARD_N * TILE
  const faceSpan = span * (BOARD_PX / GRID_PX) // frame border extends past the grid

  return (
    <>
      <color attach="background" args={[ROOM]} />
      <fog attach="fog" args={[ROOM, 18, 46]} />
      <ambientLight intensity={0.55} color="#ffe6c4" />
      <directionalLight
        castShadow position={[6, 9, 4]} intensity={1.5} color="#fff0d8"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
      />
      <directionalLight position={[-5, 6, -4]} intensity={0.35} color="#ffd9a0" />

      {/* the table the board rests on */}
      <mesh position={[0, -0.18, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.table} receiveShadow>
        <planeGeometry args={[44, 44]} />
      </mesh>
      {/* board slab + the painted face laid flat on top */}
      <mesh position={[0, -0.09, 0]} material={mats.boardEdge}>
        <boxGeometry args={[faceSpan + 0.12, 0.18, faceSpan + 0.12]} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.face} receiveShadow>
        <planeGeometry args={[faceSpan, faceSpan]} />
      </mesh>
      {/* the start pad, a small wooden coaster beside square 1 */}
      <mesh position={[start.x, 0.02, start.z]} material={mats.startPad}>
        <cylinderGeometry args={[0.42, 0.46, 0.1, 24]} />
      </mesh>
      <mesh position={[start.x, 0.075, start.z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.goldRing}>
        <ringGeometry args={[0.3, 0.36, 28]} />
      </mesh>

      {/* wooden ladders — twin rails + rungs, each leaning its own way */}
      {ladders.map((l, i) => (
        <group key={`l${i}`}>
          {l.rails.map((r, j) => (
            <mesh key={j} position={r.pos} quaternion={r.quat} material={ladderMats[i].rail} castShadow>
              <cylinderGeometry args={[l.railR, l.railR, r.len, 8]} />
            </mesh>
          ))}
          {l.rungs.map((r, j) => (
            <mesh key={`r${j}`} position={r.pos} quaternion={r.quat} material={ladderMats[i].rung} castShadow>
              <cylinderGeometry args={[l.rungR, l.rungR, r.len, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* painted snakes — tapered banded bodies with a proper head */}
      {snakes.map((s, i) => (
        <group key={`s${i}`}>
          <mesh geometry={s.geo} material={snakeMats[i]} castShadow />
          <group position={s.head.pos} rotation={[0, s.head.yaw, 0]}>
            <mesh material={snakeMats[i]} scale={[1, 0.75, 1.35]} castShadow>
              <sphereGeometry args={[s.rHead * 1.5, 14, 12]} />
            </mesh>
            {[-1, 1].map((e) => (
              <mesh key={e} material={mats.darkDetail}
                position={[e * s.rHead * 0.8, s.rHead * 0.65, s.rHead * 0.85]}>
                <sphereGeometry args={[s.rHead * 0.28, 8, 8]} />
              </mesh>
            ))}
            <mesh material={mats.tongue} position={[0, 0, s.rHead * 2.4]}>
              <boxGeometry args={[0.025, 0.02, s.rHead * 1.5]} />
            </mesh>
          </group>
        </group>
      ))}

      {/* the three racers — soft contact shadow each, gold ring on the mover */}
      {positions.map((_, seat) => (
        <group key={seat} ref={(g) => { racerRefs.current[seat] = g }}>
          <group scale={0.52}>
            <Character3D tint={SEAT_TINTS[seat % SEAT_TINTS.length]} dimmed={seat !== activeRacer} dimColor="#6b5136" />
          </group>
          <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.shadowBlob}>
            <circleGeometry args={[0.32, 20]} />
          </mesh>
          {seat === activeRacer && (
            <mesh position={[0, -0.095, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.goldRing}>
              <ringGeometry args={[0.4, 0.48, 28]} />
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
    <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-[#241309]">
      <div className="h-[340px] sm:h-[420px]">
        <Canvas
          dpr={[1, 2]}
          shadows
          camera={{ fov: 55, near: 0.1, far: 80, position: [-8, 3, 6.5] }}
          aria-label="3D Ascend board"
          role="img"
        >
          <Scene {...props} />
        </Canvas>
      </div>
      {/* warm tabletop vignette */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 42%, transparent 55%, rgba(18, 9, 3, 0.45) 100%)' }} />
    </div>
  )
}
