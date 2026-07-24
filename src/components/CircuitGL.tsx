import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Color, Object3D } from 'three'
import type { Group, InstancedMesh } from 'three'
import type { Car } from '../lib/racer'
import { laneFor, speedFeel, TRACK_METRES, CAMERA_AHEAD, CAMERA_BEHIND } from '../lib/circuit'
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
 * GPU clock. One simulation distance unit maps to one metre of road, so the
 * camera window from lib/circuit.ts (62 ahead / 26 behind) is literally the
 * stretch of asphalt in front of and behind the chase camera.
 *
 * Skeleton pass: the road is straight (the CIRCUIT curve model plugs into the
 * geometry in the track pass) and the cars are low-poly primitives — but the
 * depth, the perspective, the chase camera and the cast shadows are real.
 */

/** Mutable state shared between the page's sim loop and the GL frame loop. */
interface SimBridge {
  cars: readonly Car[]
  youId: string
  /** Player's visual odometer in units(=m) — drives the road-marking scroll. */
  scroll: number
  lastDistance: number
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
const ROAD_NEAR_Z = CAMERA_BEHIND // road extends this far behind the player…
const ROAD_FAR_Z = -(CAMERA_AHEAD + 55) // …and past the camera window into the fog
const SCROLL_TILE = 8 // dash + kerb-stripe period; the scroll group wraps on it
const EDGE_PAD_M = 3 // far-ahead rivals park just inside the window's far end
// A chase camera can't see cars behind the player — the ground enters frame
// ~3m behind them. A dropped rival slides naturally out of the bottom of the
// frame and parks just past it (the timing tower still tells the story), then
// re-enters the same way when it catches back up. Never behind the lens.
const BEHIND_VISIBLE_M = 4
const COAST_SECONDS = 1.4 // matches the old stage's roll-to-stop
const PULSE_SECONDS = 0.45

const SKY = '#3a4454' // overcast horizon — the fog colour IS the sky colour
const GRASS = '#37402f'
const ASPHALT = '#262b33'
const KERB_RED = '#b8302a'

// ---- grandstands (metres) ---------------------------------------------------
// Tiered stands flank the straight beyond the grass runoff, on both sides.
const STAND_INNER_X = 16 // inner face of the first tier (runoff = kerb → here)
const TIER_COUNT = 5
const TIER_DEPTH = 1.7 // each tier steps this far back…
const TIER_RISE = 0.95 // …and this far up
const STAND_NEAR_Z = ROAD_NEAR_Z - 2
const STAND_FAR_Z = ROAD_FAR_Z - 9 // run past the road into the fog
const STAND_LEN = STAND_NEAR_Z - STAND_FAR_Z
const STAND_MID_Z = (STAND_NEAR_Z + STAND_FAR_Z) / 2
const STAND_WALL_H = TIER_COUNT * TIER_RISE + 2.6
const ROOF_Y = STAND_WALL_H + 0.35
const CONCRETE = '#565b64'
const STAND_DARK = '#3c4049'
const ROOF_TRIM = '#c8452f' // the kerb red carried up onto the roof fascia

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** z positions of the repeating markings, one per tile across the road span. */
const TILE_ROWS: readonly number[] = Array.from(
  { length: Math.ceil((ROAD_NEAR_Z - ROAD_FAR_Z) / SCROLL_TILE) + 1 },
  (_, i) => ROAD_FAR_Z - SCROLL_TILE + i * SCROLL_TILE,
)

const CircuitGL = memo(forwardRef<CircuitHandle, Props>(function CircuitGL(
  { field, youId, reduced, flagged }, ref,
) {
  const bridge = useRef<SimBridge>({
    cars: [], youId, scroll: 0, lastDistance: 0, speedMph: 0, coast: null, pulse: null, reduced,
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
  const scrollRef = useRef<Group>(null)

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05) // a backgrounded tab must not leap
    const you = bridge.cars.find((c) => c.id === bridge.youId)

    // Odometer: track the sim while it runs, then integrate the coast-down.
    if (you) {
      // max(0, …): a race restart resets distance to 0 — never scroll backward.
      bridge.scroll += Math.max(0, you.distance - bridge.lastDistance)
      bridge.lastDistance = you.distance
      bridge.speedMph = you.speed
    }
    if (bridge.coast) {
      const c = bridge.coast
      c.v = Math.max(0, c.v - (c.v0 / COAST_SECONDS) * dt)
      bridge.scroll += c.v * dt
      bridge.speedMph = c.v
    }

    // The world streams past the fixed player: markings shift toward +z and
    // wrap every tile, which is what makes speed visible on a straight road.
    if (scrollRef.current) scrollRef.current.position.z = bridge.scroll % SCROLL_TILE

    // Cars: player pinned at z=0; rivals at their true distance delta down the
    // road, clamped just inside the camera window so they never pop out.
    const youDistance = you?.distance ?? bridge.lastDistance
    for (const car of bridge.cars) {
      const g = carRefs.current.get(car.id)
      if (!g) continue
      const delta = car.distance - youDistance
      g.position.z = -clamp(delta, -BEHIND_VISIBLE_M, CAMERA_AHEAD - EDGE_PAD_M)
    }

    // Chase camera: behind and above the player, eyes down the road. The bob
    // is the speed you feel in the cockpit; the pulse is the answer kick.
    let camY = 6
    let camZ = 11.5
    if (!bridge.reduced) {
      const feel = speedFeel(bridge.speedMph)
      camY += Math.sin(bridge.scroll * 0.6) * feel * feel * 0.05
      if (bridge.pulse) {
        const p = bridge.pulse
        p.t += dt
        if (p.t >= PULSE_SECONDS) bridge.pulse = null
        else {
          const k = Math.sin((p.t / PULSE_SECONDS) * Math.PI) // in-out, one arc
          camZ -= p.dir * k * 0.6 // surge in on a correct, sag back on a miss
          camY += p.dir * k * -0.12
        }
      }
    }
    state.camera.position.set(0, camY, camZ)
    state.camera.lookAt(0, 0.6, -22)
  })

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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, (ROAD_NEAR_Z + ROAD_FAR_Z) / 2]} receiveShadow>
        <planeGeometry args={[TRACK_METRES + 1.4, ROAD_NEAR_Z - ROAD_FAR_Z]} />
        <meshStandardMaterial color={ASPHALT} roughness={0.95} />
      </mesh>
      {/* kerb base strips (static red; the scrolling white blocks stripe them) */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (ROAD_HALF_W + 0.35), 0.02, (ROAD_NEAR_Z + ROAD_FAR_Z) / 2]} receiveShadow>
          <boxGeometry args={[0.7, 0.04, ROAD_NEAR_Z - ROAD_FAR_Z]} />
          <meshStandardMaterial color={KERB_RED} roughness={0.9} />
        </mesh>
      ))}

      {/* ---- grandstands flanking the straight ---- */}
      {([-1, 1] as const).map((side) => (
        <Grandstand key={side} side={side} />
      ))}

      {/* ---- scrolling markings: centre-line dashes + kerb stripes ---- */}
      <group ref={scrollRef}>
        {TILE_ROWS.map((z) => (
          <group key={z}>
            <mesh position={[0, 0.02, z]}>
              <boxGeometry args={[0.3, 0.02, 3]} />
              <meshStandardMaterial color="#c9d2dd" roughness={0.8} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * (ROAD_HALF_W + 0.35), 0.05, z]}>
                <boxGeometry args={[0.7, 0.04, 4]} />
                <meshStandardMaterial color="#e8ecf2" roughness={0.9} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* ---- the crowd ---- */}
      <Crowd bridge={bridge} />

      {/* ---- the field ---- */}
      {field.map((car, i) => (
        <group
          key={car.id}
          position={[laneFor(i) * TRACK_METRES, 0, 0]}
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
// Grandstands: five stepped concrete tiers, a back wall, and a roof slab with
// a red fascia — one solid stand per side, long enough to vanish into the fog.

const PILLAR_ZS: readonly number[] = Array.from(
  { length: 7 },
  (_, i) => STAND_NEAR_Z - (i + 0.5) * (STAND_LEN / 7),
)

function Grandstand({ side }: { side: -1 | 1 }) {
  return (
    <group>
      {/* stepped tiers, each one taller and further back than the last */}
      {Array.from({ length: TIER_COUNT }, (_, k) => (
        <mesh
          key={k}
          position={[
            side * (STAND_INNER_X + (k + 0.5) * TIER_DEPTH),
            ((k + 1) * TIER_RISE) / 2,
            STAND_MID_Z,
          ]}
          receiveShadow
        >
          <boxGeometry args={[TIER_DEPTH, (k + 1) * TIER_RISE, STAND_LEN]} />
          <meshStandardMaterial color={CONCRETE} roughness={1} />
        </mesh>
      ))}
      {/* spectator barrier between the runoff and the front row */}
      <mesh position={[side * (STAND_INNER_X - 0.6), 0.55, STAND_MID_Z]}>
        <boxGeometry args={[0.25, 1.1, STAND_LEN]} />
        <meshStandardMaterial color="#c7ccd4" roughness={0.9} />
      </mesh>
      {/* back wall closing off the top tier */}
      <mesh position={[side * (STAND_INNER_X + TIER_COUNT * TIER_DEPTH + 0.3), STAND_WALL_H / 2, STAND_MID_Z]}>
        <boxGeometry args={[0.6, STAND_WALL_H, STAND_LEN]} />
        <meshStandardMaterial color={STAND_DARK} roughness={1} />
      </mesh>
      {/* roof slab + the red fascia along its track-side edge */}
      <mesh position={[side * (STAND_INNER_X + (TIER_COUNT * TIER_DEPTH) / 2 - 0.3), ROOF_Y, STAND_MID_Z]}>
        <boxGeometry args={[TIER_COUNT * TIER_DEPTH + 2.4, 0.3, STAND_LEN]} />
        <meshStandardMaterial color="#2b2f36" roughness={1} />
      </mesh>
      <mesh position={[side * (STAND_INNER_X - 1.7), ROOF_Y - 0.28, STAND_MID_Z]}>
        <boxGeometry args={[0.3, 0.6, STAND_LEN]} />
        <meshStandardMaterial color={ROOF_TRIM} roughness={0.85} />
      </mesh>
      {/* front pillars carrying the roof */}
      {PILLAR_ZS.map((z) => (
        <mesh key={z} position={[side * (STAND_INNER_X - 1.55), ROOF_Y / 2, z]}>
          <boxGeometry args={[0.28, ROOF_Y, 0.28]} />
          <meshStandardMaterial color={STAND_DARK} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The crowd: two InstancedMeshes (bodies + heads) — a couple of draw calls for
// the whole thousand-strong crowd. Layout, colours, and cheer phases are baked
// once from a seeded PRNG so every visit sees the same (varied) crowd.

const SEAT_STEP = 1.15 // shoulder-to-shoulder spacing along the stand
const SEATS_PER_TIER = Math.floor(STAND_LEN / SEAT_STEP)
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
  x: Float32Array
  z: Float32Array
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
  const xs: number[] = []
  const zs: number[] = []
  const scales: number[] = []
  const bodyYs: number[] = []
  const headYs: number[] = []
  const phases: number[] = []
  const amps: number[] = []
  const bodyColor: Color[] = []
  const headColor: Color[] = []
  for (const side of [-1, 1] as const) {
    for (let tier = 0; tier < TIER_COUNT; tier++) {
      const tierTop = (tier + 1) * TIER_RISE
      const tierX = STAND_INNER_X + (tier + 0.5) * TIER_DEPTH
      for (let seat = 0; seat < SEATS_PER_TIER; seat++) {
        if (rnd() < 0.12) continue // a few empty seats — full, not painted-on
        const s = 0.85 + rnd() * 0.3
        xs.push(side * (tierX + (rnd() - 0.5) * 0.5))
        const z = STAND_NEAR_Z - (seat + 0.5) * SEAT_STEP + (rnd() - 0.5) * 0.5
        zs.push(z)
        scales.push(s)
        bodyYs.push(tierTop + 0.5 * s)
        headYs.push(tierTop + 1.1 * s)
        // Phase rides mostly on z so the cheer RIPPLES down the stand as a
        // wave, with per-person jitter so it never reads as a march.
        phases.push(z * 0.28 + side * 1.4 + rnd() * 1.6)
        amps.push(0.1 + rnd() * 0.3)
        bodyColor.push(new Color(CLOTHES[Math.floor(rnd() * CLOTHES.length)]))
        headColor.push(new Color(SKIN[Math.floor(rnd() * SKIN.length)]))
      }
    }
  }
  return {
    count: xs.length,
    x: Float32Array.from(xs),
    z: Float32Array.from(zs),
    scale: Float32Array.from(scales),
    bodyY: Float32Array.from(bodyYs),
    headY: Float32Array.from(headYs),
    phase: Float32Array.from(phases),
    amp: Float32Array.from(amps),
    bodyColor,
    headColor,
  }
}

function Crowd({ bridge }: { bridge: SimBridge }) {
  const bodies = useRef<InstancedMesh>(null)
  const heads = useRef<InstancedMesh>(null)
  const layout = useMemo(buildCrowd, [])
  const scratch = useMemo(() => new Object3D(), [])

  // Bake every instance's resting transform + colour once.
  useLayoutEffect(() => {
    const body = bodies.current
    const head = heads.current
    if (!body || !head) return
    for (let i = 0; i < layout.count; i++) {
      const s = layout.scale[i]
      scratch.scale.setScalar(s)
      scratch.position.set(layout.x[i], layout.bodyY[i], layout.z[i])
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

  // The cheer: a cheap per-instance hop. Only the matrix's y-translation slot
  // (element 13, column-major) is rewritten each frame — no allocation, no
  // recompose. sin² keeps everyone grounded half the cycle, so it reads as
  // jumping fans, and the z-keyed phase makes the wave roll down the stand.
  useFrame(({ clock }) => {
    if (bridge.reduced) return
    const body = bodies.current
    const head = heads.current
    if (!body || !head) return
    const t = clock.elapsedTime * CHEER_HZ
    const bm = body.instanceMatrix.array
    const hm = head.instanceMatrix.array
    const { count, phase, amp, bodyY, headY } = layout
    for (let i = 0; i < count; i++) {
      const w = Math.sin(t + phase[i])
      const hop = w > 0 ? w * w * amp[i] : 0
      bm[i * 16 + 13] = bodyY[i] + hop
      hm[i * 16 + 13] = headY[i] + hop * HEAD_LIFT
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


