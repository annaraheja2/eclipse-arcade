import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Color, Object3D } from 'three'
import type { Group, InstancedMesh } from 'three'
import type { Car } from '../lib/racer'
import {
  laneFor, speedFeel, TRACK_METRES, CAMERA_AHEAD,
  makePoseTable, fillPoseTable, samplePose, type Pose, type PoseTable,
} from '../lib/circuit'
import type { CircuitHandle } from './Circuit'
import { F1Car } from './F1CarMesh'

/**
 * The real-3D circuit stage: a WebGL scene (three.js via react-three-fiber)
 * replacing the CSS-plane/SVG illusion in Circuit.tsx. Same contract — the
 * page's rAF loop pushes authoritative sim state through the imperative
 * handle every frame; NOTHING here re-renders React during a race.
 *
 * The bridge between the two loops is a plain mutable object: `render()`
 * writes the latest cars into it, and the scene's `useFrame` reads it on the
 * GPU clock. One simulation distance unit maps to one metre of road.
 *
 * The track BENDS for real. Every frame the scene fills one pose table — the
 * lap centreline from lib/circuit.ts, integrated around the player's current
 * distance — and then positions EVERYTHING by (track distance, lateral
 * offset): the road is a ring buffer of short pieces recycled onto 4 m track
 * slots, the grandstands are chunks recycled onto 14 m slots, every crowd
 * member and car sits at its own distance along the path, and the camera
 * chases the player down the centreline, eyes on the road ahead — so a corner
 * swings the whole world through the frame. The player's pose anchors the
 * table at the origin, which is why the path never needs to close into a loop.
 */

/** Mutable state shared between the page's sim loop and the GL frame loop. */
interface SimBridge {
  cars: readonly Car[]
  youId: string
  /** Player's visual odometer in units(=m) — anchors the pose table. Tracks
   *  the sim while it runs, then keeps rolling through the post-flag coast. */
  visual: number
  speedMph: number
  /** Post-flag visual roll-down: current mph and the starting mph for decay. */
  coast: { v: number; v0: number } | null
  /** One-shot camera kick on an answer; t counts up to PULSE_SECONDS. */
  pulse: { dir: 1 | -1; t: number } | null
  reduced: boolean
}

interface Props {
  field: readonly Car[]
  youId: string
  reduced: boolean
  flagged: boolean
}

// ---- world constants (metres) ----------------------------------------------
const ROAD_HALF_W = TRACK_METRES / 2
const ROAD_BEHIND = 28 // road extends this far behind the player…
const ROAD_AHEAD = 118 // …and past the camera window into the fog
// One road piece per 4 m track slot: short enough that a chain of flat pieces
// reads as a smooth arc through the tightest corner (~5° between neighbours),
// long enough that the whole road is a few dozen meshes. Kerbs alternate
// red/white on this period; the centre dash lands on every second slot (8 m).
const ROAD_STEP = 4
const ROAD_PIECES = Math.ceil((ROAD_BEHIND + ROAD_AHEAD) / ROAD_STEP) + 1 // 38 — even, so slot parity is stable per pool piece
const PIECE_LEN = ROAD_STEP + 0.8 // overlap hides the wedge gaps on a bend
// Y epsilon between overlapping neighbours (baked by pool parity) — the
// overlap regions must not z-fight.
const LAYER_EPS = 0.0015
const EDGE_PAD_M = 3 // far-ahead rivals park just inside the window's far end
// A chase camera can't see cars behind the player — the ground enters frame
// ~3m behind them. A dropped rival slides naturally out of the bottom of the
// frame and parks just past it (the timing tower still tells the story), then
// re-enters the same way when it catches back up. Never behind the lens.
const BEHIND_VISIBLE_M = 4
const CAR_AXLE_LOOK = 2.6 // yaw each car to the heading at its front axle
const COAST_SECONDS = 1.4 // matches the old stage's roll-to-stop
const PULSE_SECONDS = 0.45
const CAM_BACK = 11.5 // chase camera trails this far down the centreline
const CAM_LOOK_AHEAD = 22 // …and aims at the centreline this far up the road

// The pose table must cover everything sampled off it: road (−28…+118),
// stand chunks incl. slot slack and seat jitter (−43…+141), cars, camera.
const TABLE_BEHIND = 45
const TABLE_AHEAD = 145

const SKY = '#3a4454' // overcast horizon — the fog colour IS the sky colour
const GRASS = '#37402f'
const ASPHALT = '#262b33'
const KERB_RED = '#b8302a'
const KERB_WHITE = '#e8ecf2'

// ---- grandstands (metres) ---------------------------------------------------
// Tiered stands flank the track beyond the grass runoff, on both sides,
// following it round every bend as a chain of straight 14 m chunks.
const STAND_INNER_X = 16 // inner face of the first tier (runoff = kerb → here)
const TIER_COUNT = 5
const TIER_DEPTH = 1.7 // each tier steps this far back…
const TIER_RISE = 0.95 // …and this far up
const STAND_BEHIND = 28 // stand coverage window around the player…
const STAND_AHEAD = 126 // …runs past the road into the fog
const STAND_CHUNK = 14
const STAND_CHUNKS = Math.ceil((STAND_BEHIND + STAND_AHEAD) / STAND_CHUNK) + 1 // 12 per side
const CHUNK_LEN = STAND_CHUNK + 0.8 // same overlap trick as the road pieces
const STAND_WALL_H = TIER_COUNT * TIER_RISE + 2.6
const ROOF_Y = STAND_WALL_H + 0.35
const CONCRETE = '#565b64'
const STAND_DARK = '#3c4049'
const ROOF_TRIM = '#c8452f' // the kerb red carried up onto the roof fascia

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const wrap = (v: number, n: number) => ((v % n) + n) % n

// Scratch poses for the frame loops — never allocated per frame.
const P1: Pose = { x: 0, z: 0, heading: 0 }
const P2: Pose = { x: 0, z: 0, heading: 0 }

/** Per-frame path state shared between the scene loop (fills it, priority −1)
 *  and the crowd loop (reads it, priority 0). */
interface PathState {
  table: PoseTable
  /** centre-of-chunk delta from the player, per stand slot, this frame */
  chunkDelta: Float32Array
}

const CircuitGL = memo(forwardRef<CircuitHandle, Props>(function CircuitGL(
  { field, youId, reduced, flagged }, ref,
) {
  const bridge = useRef<SimBridge>({
    cars: [], youId, visual: 0, speedMph: 0, coast: null, pulse: null, reduced,
  }).current
  bridge.reduced = reduced // props can change between races; the loop reads live

  useImperativeHandle(ref, () => ({
    render(cars, id) {
      bridge.cars = cars
      bridge.youId = id
      bridge.coast = null
    },
    coastToStop(speedMph) {
      if (bridge.reduced || speedMph <= 0) return
      bridge.coast = { v: speedMph, v0: speedMph }
    },
    pulse(dir) {
      if (bridge.reduced) return
      bridge.pulse = { dir: dir === 'up' ? 1 : -1, t: 0 }
    },
  }), [bridge])

  return (
    <div className="rc-stage">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, toneMappingExposure: 1.3 }}
        camera={{ fov: 52, near: 1, far: 220, position: [0, 6, 11.5] }}
        aria-label="3D race circuit"
        role="img"
      >
        <Scene bridge={bridge} field={field} youId={youId} />
      </Canvas>
      {flagged && <div aria-hidden className="rc-flag" />}
      <div aria-hidden className="rc-vignette" />
    </div>
  )
}))

export default CircuitGL

// ---------------------------------------------------------------------------

function Scene({ bridge, field, youId }: { bridge: SimBridge; field: readonly Car[]; youId: string }) {
  const carRefs = useRef(new Map<string, Group>())
  const roadRefs = useRef<(Group | null)[]>(Array.from({ length: ROAD_PIECES }, () => null))
  const standRefs = useRef<(Group | null)[]>(Array.from({ length: STAND_CHUNKS * 2 }, () => null))
  const path = useMemo<PathState>(() => ({
    table: makePoseTable(TABLE_BEHIND, TABLE_AHEAD),
    chunkDelta: new Float32Array(STAND_CHUNKS),
  }), [])

  // Priority −1: everything here — above all the pose table — must be settled
  // before the crowd's default-priority frame loop samples it.
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05) // a backgrounded tab must not leap
    const you = bridge.cars.find((c) => c.id === bridge.youId)

    // Odometer: track the sim while it runs, then integrate the coast-down.
    if (you && !bridge.coast) {
      bridge.visual = you.distance
      bridge.speedMph = you.speed
    }
    if (bridge.coast) {
      const c = bridge.coast
      c.v = Math.max(0, c.v - (c.v0 / COAST_SECONDS) * dt)
      bridge.visual += c.v * dt
      bridge.speedMph = c.v
    }

    // The centreline around the player, this frame. Player = origin, so world
    // motion (and every corner) is the path re-expressed in the player's frame.
    const { table, chunkDelta } = path
    fillPoseTable(table, bridge.visual)

    // Road ring buffer: piece i always serves the track slot ≡ i (mod count),
    // so its baked kerb colour / dash stays glued to the same stretch of road.
    const firstSlot = Math.floor((bridge.visual - ROAD_BEHIND) / ROAD_STEP)
    for (let i = 0; i < ROAD_PIECES; i++) {
      const g = roadRefs.current[i]
      if (!g) continue
      const slot = firstSlot + wrap(i - firstSlot, ROAD_PIECES)
      samplePose(table, slot * ROAD_STEP + ROAD_STEP / 2 - bridge.visual, P1)
      g.position.set(P1.x, (i % 2) * LAYER_EPS, P1.z)
      g.rotation.y = -P1.heading
    }

    // Grandstand chunks, same recycling, one slot grid shared by both sides.
    const firstChunk = Math.floor((bridge.visual - STAND_BEHIND) / STAND_CHUNK)
    for (let i = 0; i < STAND_CHUNKS; i++) {
      const slot = firstChunk + wrap(i - firstChunk, STAND_CHUNKS)
      const delta = slot * STAND_CHUNK + STAND_CHUNK / 2 - bridge.visual
      chunkDelta[i] = delta
      samplePose(table, delta, P1)
      for (const side of [0, 1]) {
        const g = standRefs.current[side * STAND_CHUNKS + i]
        if (!g) continue
        g.position.set(P1.x, (i % 2) * LAYER_EPS, P1.z)
        g.rotation.y = -P1.heading
      }
    }

    // Cars: each sits on the path at its distance delta from the player
    // (clamped just inside the camera window so it never pops out), pushed
    // sideways along the path's right-hand perpendicular by its lane, and
    // yawed to the heading at its front axle — the whole field noses into
    // every corner and stays on the asphalt through it.
    const youDistance = you?.distance ?? 0
    for (let i = 0; i < bridge.cars.length; i++) {
      const car = bridge.cars[i]
      const g = carRefs.current.get(car.id)
      if (!g) continue
      const delta = clamp(car.distance - youDistance, -BEHIND_VISIBLE_M, CAMERA_AHEAD - EDGE_PAD_M)
      samplePose(table, delta, P1)
      const lane = laneFor(i) * TRACK_METRES
      g.position.set(P1.x + Math.cos(P1.heading) * lane, 0, P1.z + Math.sin(P1.heading) * lane)
      samplePose(table, delta + CAR_AXLE_LOOK, P2)
      g.rotation.y = -P2.heading
    }

    // Chase camera: trailing the player down the CENTRELINE — through a
    // corner it hangs back on the track's own curve — eyes on the road ahead,
    // so the upcoming bend swings into frame before the player reaches it.
    // The bob is the speed you feel in the cockpit; the pulse is the answer kick.
    let camY = 6
    let camBack = CAM_BACK
    if (!bridge.reduced) {
      const feel = speedFeel(bridge.speedMph)
      camY += Math.sin(bridge.visual * 0.6) * feel * feel * 0.05
      if (bridge.pulse) {
        const p = bridge.pulse
        p.t += dt
        if (p.t >= PULSE_SECONDS) bridge.pulse = null
        else {
          const k = Math.sin((p.t / PULSE_SECONDS) * Math.PI) // in-out, one arc
          camBack -= p.dir * k * 0.6 // surge in on a correct, sag back on a miss
          camY += p.dir * k * -0.12
        }
      }
    }
    samplePose(table, -camBack, P1)
    state.camera.position.set(P1.x, camY, P1.z)
    samplePose(table, CAM_LOOK_AHEAD, P2)
    state.camera.lookAt(P2.x, 0.6, P2.z)
  }, -1)

  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 55, 165]} />

      <hemisphereLight args={['#a7b6cc', '#333a2c', 1.15]} />
      {/* key light from behind-left of the camera so the faces we actually
          see are lit, and every car throws its shadow up the road ahead */}
      <directionalLight
        position={[-16, 24, 18]}
        intensity={2.2}
        color="#fff2dd"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-bias={-0.0004}
      />

      {/* ---- the world ---- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -60]} receiveShadow>
        <planeGeometry args={[500, 420]} />
        <meshStandardMaterial color={GRASS} roughness={1} />
      </mesh>

      {/* ---- the road: a ring buffer of pieces laid along the centreline ---- */}
      {Array.from({ length: ROAD_PIECES }, (_, i) => (
        <RoadPiece
          key={i}
          even={i % 2 === 0}
          ref={(g: Group | null) => { roadRefs.current[i] = g }}
        />
      ))}

      {/* ---- grandstands lining both sides of the path ---- */}
      {([-1, 1] as const).map((side, s) => (
        Array.from({ length: STAND_CHUNKS }, (_, i) => (
          <StandChunk
            key={`${side}:${i}`}
            side={side}
            ref={(g: Group | null) => { standRefs.current[s * STAND_CHUNKS + i] = g }}
          />
        ))
      ))}

      {/* ---- the crowd ---- */}
      <Crowd bridge={bridge} path={path} />

      {/* ---- the field ---- */}
      {field.map((car) => (
        <group
          key={car.id}
          ref={(g: Group | null) => {
            if (g) carRefs.current.set(car.id, g)
            else carRefs.current.delete(car.id)
          }}
        >
          <F1Car color={car.color} isPlayer={car.id === youId} />
        </group>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// One 4 m piece of road: asphalt slab, a kerb block each side, and — on every
// second slot — a 3 m centre-line dash. The kerbs alternate red/white piece to
// piece, which is both the classic kerb AND what makes speed (and the bend)
// readable now that the road itself moves through the world.

const RoadPiece = memo(forwardRef<Group, { even: boolean }>(function RoadPiece({ even }, ref) {
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TRACK_METRES + 1.4, PIECE_LEN]} />
        <meshStandardMaterial color={ASPHALT} roughness={0.95} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (ROAD_HALF_W + 0.35), 0.02, 0]} receiveShadow>
          <boxGeometry args={[0.7, 0.04, PIECE_LEN]} />
          <meshStandardMaterial color={even ? KERB_RED : KERB_WHITE} roughness={0.9} />
        </mesh>
      ))}
      {even && (
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.3, 0.02, 3]} />
          <meshStandardMaterial color="#c9d2dd" roughness={0.8} />
        </mesh>
      )}
    </group>
  )
}))

// ---------------------------------------------------------------------------
// Grandstands: five stepped concrete tiers, a back wall, a roof slab with a
// red fascia and a pillar — one 14 m chunk, repeated down BOTH sides of the
// path so the stands sweep round every corner with the road.

const StandChunk = memo(forwardRef<Group, { side: -1 | 1 }>(function StandChunk({ side }, ref) {
  return (
    <group ref={ref}>
      {/* stepped tiers, each one taller and further back than the last */}
      {Array.from({ length: TIER_COUNT }, (_, k) => (
        <mesh
          key={k}
          position={[side * (STAND_INNER_X + (k + 0.5) * TIER_DEPTH), ((k + 1) * TIER_RISE) / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[TIER_DEPTH, (k + 1) * TIER_RISE, CHUNK_LEN]} />
          <meshStandardMaterial color={CONCRETE} roughness={1} />
        </mesh>
      ))}
      {/* spectator barrier between the runoff and the front row */}
      <mesh position={[side * (STAND_INNER_X - 0.6), 0.55, 0]}>
        <boxGeometry args={[0.25, 1.1, CHUNK_LEN]} />
        <meshStandardMaterial color="#c7ccd4" roughness={0.9} />
      </mesh>
      {/* back wall closing off the top tier */}
      <mesh position={[side * (STAND_INNER_X + TIER_COUNT * TIER_DEPTH + 0.3), STAND_WALL_H / 2, 0]}>
        <boxGeometry args={[0.6, STAND_WALL_H, CHUNK_LEN]} />
        <meshStandardMaterial color={STAND_DARK} roughness={1} />
      </mesh>
      {/* roof slab + the red fascia along its track-side edge */}
      <mesh position={[side * (STAND_INNER_X + (TIER_COUNT * TIER_DEPTH) / 2 - 0.3), ROOF_Y, 0]}>
        <boxGeometry args={[TIER_COUNT * TIER_DEPTH + 2.4, 0.3, CHUNK_LEN]} />
        <meshStandardMaterial color="#2b2f36" roughness={1} />
      </mesh>
      <mesh position={[side * (STAND_INNER_X - 1.7), ROOF_Y - 0.28, 0]}>
        <boxGeometry args={[0.3, 0.6, CHUNK_LEN]} />
        <meshStandardMaterial color={ROOF_TRIM} roughness={0.85} />
      </mesh>
      {/* front pillar carrying the roof, one per chunk */}
      <mesh position={[side * (STAND_INNER_X - 1.55), ROOF_Y / 2, 0]}>
        <boxGeometry args={[0.28, ROOF_Y, 0.28]} />
        <meshStandardMaterial color={STAND_DARK} roughness={1} />
      </mesh>
    </group>
  )
}))

// ---------------------------------------------------------------------------
// The crowd: two InstancedMeshes (bodies + heads) — a couple of draw calls for
// the whole thousand-strong crowd. Colours, sizes and cheer phases are baked
// once from a seeded PRNG; every member belongs to a stand chunk and rides its
// slot round the circuit, so the crowd bends with the stands. Positions are
// therefore written every frame — but only the three translation slots of each
// baked matrix, from the shared pose table. No allocation, no recompose.

const SEAT_STEP = 1.15 // shoulder-to-shoulder spacing along the stand
const SEATS_PER_CHUNK = Math.floor(STAND_CHUNK / SEAT_STEP)
const CHEER_HZ = 3.1 // cheer wave angular speed multiplier (rad/s)
const HEAD_LIFT = 1.25 // heads overshoot the body hop — reads as arms-up energy

const CLOTHES = [
  '#d94438', '#e88a2d', '#e8c93c', '#3fa864', '#3e7fd1', '#7c53c9',
  '#d15a92', '#dcd6c8', '#2c313b', '#67b8c9', '#b03a52', '#4c8a3f',
] as const
const SKIN = ['#f0c8a0', '#d9a06a', '#a8703f', '#6f4a2f'] as const

/** Deterministic PRNG (mulberry32) — the crowd never reshuffles between mounts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface CrowdLayout {
  count: number
  chunk: Int16Array // stand-slot pool index (shared by both sides)
  along: Float32Array // distance offset from the chunk's centre, metres
  lat: Float32Array // signed lateral offset from the centreline
  scale: Float32Array
  bodyY: Float32Array // resting body-centre height
  headY: Float32Array // resting head-centre height
  phase: Float32Array // cheer-wave offset per person
  amp: Float32Array // how high this person hops
  bodyColor: Color[]
  headColor: Color[]
}

function buildCrowd(): CrowdLayout {
  const rnd = mulberry32(0x5eed)
  const chunks: number[] = []
  const alongs: number[] = []
  const lats: number[] = []
  const scales: number[] = []
  const bodyYs: number[] = []
  const headYs: number[] = []
  const phases: number[] = []
  const amps: number[] = []
  const bodyColor: Color[] = []
  const headColor: Color[] = []
  for (const side of [-1, 1] as const) {
    for (let chunk = 0; chunk < STAND_CHUNKS; chunk++) {
      for (let tier = 0; tier < TIER_COUNT; tier++) {
        const tierTop = (tier + 1) * TIER_RISE
        const tierX = STAND_INNER_X + (tier + 0.5) * TIER_DEPTH
        for (let seat = 0; seat < SEATS_PER_CHUNK; seat++) {
          if (rnd() < 0.12) continue // a few empty seats — full, not painted-on
          const s = 0.85 + rnd() * 0.3
          const along = (seat + 0.5) * SEAT_STEP - STAND_CHUNK / 2 + (rnd() - 0.5) * 0.5
          chunks.push(chunk)
          alongs.push(along)
          lats.push(side * (tierX + (rnd() - 0.5) * 0.5))
          scales.push(s)
          bodyYs.push(tierTop + 0.5 * s)
          headYs.push(tierTop + 1.1 * s)
          // Phase rides mostly on position along the stand so the cheer
          // RIPPLES down it as a wave, with per-person jitter so it never
          // reads as a march.
          phases.push((chunk * STAND_CHUNK + along) * 0.28 + side * 1.4 + rnd() * 1.6)
          amps.push(0.1 + rnd() * 0.3)
          bodyColor.push(new Color(CLOTHES[Math.floor(rnd() * CLOTHES.length)]))
          headColor.push(new Color(SKIN[Math.floor(rnd() * SKIN.length)]))
        }
      }
    }
  }
  return {
    count: chunks.length,
    chunk: Int16Array.from(chunks),
    along: Float32Array.from(alongs),
    lat: Float32Array.from(lats),
    scale: Float32Array.from(scales),
    bodyY: Float32Array.from(bodyYs),
    headY: Float32Array.from(headYs),
    phase: Float32Array.from(phases),
    amp: Float32Array.from(amps),
    bodyColor,
    headColor,
  }
}

function Crowd({ bridge, path }: { bridge: SimBridge; path: PathState }) {
  const bodies = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)
  const layout = useMemo(buildCrowd, [])
  const scratch = useMemo(() => new Object3D(), [])

  // Bake every instance's scale + colour once; translation is written per
  // frame from the pose table (default matrix position is a harmless origin).
  useLayoutEffect(() => {
    const body = bodies.current
    const head = heads.current
    if (!body || !head) return
    for (let i = 0; i < layout.count; i++) {
      scratch.scale.setScalar(layout.scale[i])
      scratch.position.set(0, layout.bodyY[i], 0)
      scratch.updateMatrix()
      body.setMatrixAt(i, scratch.matrix)
      body.setColorAt(i, layout.bodyColor[i])
      scratch.position.y = layout.headY[i]
      scratch.updateMatrix()
      head.setMatrixAt(i, scratch.matrix)
      head.setColorAt(i, layout.headColor[i])
    }
    body.instanceMatrix.needsUpdate = true
    head.instanceMatrix.needsUpdate = true
    if (body.instanceColor) body.instanceColor.needsUpdate = true
    if (head.instanceColor) head.instanceColor.needsUpdate = true
  }, [layout, scratch])

  // Runs AFTER the scene loop (priority −1) has filled the pose table. Each
  // member samples the centreline at its own track distance and slides out to
  // its seat along the path's perpendicular — the stands' worth of crowd bends
  // through the corners with the road. Only the matrix translation slots
  // (elements 12/13/14, column-major) are rewritten. The cheer hop rides on
  // top: sin² keeps everyone grounded half the cycle, so it reads as jumping
  // fans; under reduced motion the hop is skipped but seats still track the
  // stand they sit in.
  useFrame(({ clock }) => {
    const body = bodies.current
    const head = heads.current
    if (!body || !head) return
    const t = clock.elapsedTime * CHEER_HZ
    const bm = body.instanceMatrix.array
    const hm = head.instanceMatrix.array
    const { table, chunkDelta } = path
    const { count, chunk, along, lat, phase, amp, bodyY, headY } = layout
    const cheering = !bridge.reduced
    for (let i = 0; i < count; i++) {
      samplePose(table, chunkDelta[chunk[i]] + along[i], P1)
      const sin = Math.sin(P1.heading)
      const cos = Math.cos(P1.heading)
      const wx = P1.x + cos * lat[i]
      const wz = P1.z + sin * lat[i]
      let hop = 0
      if (cheering) {
        const w = Math.sin(t + phase[i])
        hop = w > 0 ? w * w * amp[i] : 0
      }
      bm[i * 16 + 12] = wx
      bm[i * 16 + 13] = bodyY[i] + hop
      bm[i * 16 + 14] = wz
      hm[i * 16 + 12] = wx
      hm[i * 16 + 13] = headY[i] + hop * HEAD_LIFT
      hm[i * 16 + 14] = wz
    }
    body.instanceMatrix.needsUpdate = true
    head.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {/* geometry/material live in JSX so r3f disposes them on unmount; the
          crowd casts no shadows and skips culling (it is always in frame) */}
      <instancedMesh ref={bodies} args={[undefined, undefined, layout.count]} frustumCulled={false}>
        <capsuleGeometry args={[0.22, 0.55, 2, 6]} />
        <meshLambertMaterial color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, layout.count]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 6, 5]} />
        <meshLambertMaterial color="#ffffff" />
      </instancedMesh>
    </>
  )
}
