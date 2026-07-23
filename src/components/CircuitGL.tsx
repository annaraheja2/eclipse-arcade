import { forwardRef, memo, useImperativeHandle, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { Car } from '../lib/racer'
import { laneFor, speedFeel, TRACK_METRES, CAMERA_AHEAD, CAMERA_BEHIND } from '../lib/circuit'
import type { CircuitHandle } from './Circuit'

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
const CARBON = '#1b1d21'
const TYRE = '#141519'

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

/**
 * Placeholder-but-real-3D single seater: a handful of boxes and four cylinder
 * wheels at true F1 proportions (~5.2m long, wheels ~0.72m tall), tinted by
 * the car's livery colour. The proper model lands in the art pass; this
 * pass's job is that it reads as a solid casting a real shadow. Nose faces
 * -z, the direction of travel.
 */
function F1Car({ color, isPlayer }: { color: string; isPlayer: boolean }) {
  return (
    <group>
      {/* monocoque + engine cover */}
      <mesh position={[0, 0.42, 0.3]} castShadow>
        <boxGeometry args={[1.0, 0.5, 3.0]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
      </mesh>
      {/* nose */}
      <mesh position={[0, 0.36, -1.85]} castShadow>
        <boxGeometry args={[0.5, 0.3, 1.5]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
      </mesh>
      {/* front wing */}
      <mesh position={[0, 0.16, -2.5]} castShadow>
        <boxGeometry args={[1.9, 0.09, 0.55]} />
        <meshStandardMaterial color={CARBON} roughness={0.6} />
      </mesh>
      {/* cockpit / halo block */}
      <mesh position={[0, 0.78, 0.05]} castShadow>
        <boxGeometry args={[0.55, 0.3, 1.0]} />
        <meshStandardMaterial color={CARBON} roughness={0.5} />
      </mesh>
      {/* airbox + T-cam: fluoro white marks the player's car, dark the rivals */}
      <mesh position={[0, 1.0, 0.45]} castShadow>
        <boxGeometry args={[0.24, 0.22, 0.7]} />
        <meshStandardMaterial color={isPlayer ? '#f4f6fa' : CARBON} roughness={0.5} />
      </mesh>
      {/* rear wing */}
      <mesh position={[0, 0.92, 1.85]} castShadow>
        <boxGeometry args={[1.5, 0.1, 0.5]} />
        <meshStandardMaterial color={CARBON} roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.72, 0.6, 1.85]} castShadow>
          <boxGeometry args={[0.06, 0.55, 0.5]} />
          <meshStandardMaterial color={color} roughness={0.4} />
        </mesh>
      ))}
      {/* wheels: front pair, rear pair */}
      {([[-0.82, -1.15, 0.33], [0.82, -1.15, 0.33], [-0.86, 1.25, 0.36], [0.86, 1.25, 0.36]] as const).map(([x, z, r]) => (
        <mesh key={`${x},${z}`} position={[x, r, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[r, r, 0.38, 18]} />
          <meshStandardMaterial color={TYRE} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}
