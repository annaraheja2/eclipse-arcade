import { forwardRef, useImperativeHandle, useRef } from 'react'
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { Group } from 'three'

/**
 * Procedural Formula 1 car + seated driver, built entirely from three.js
 * primitives at true scale (~5.2m long, ~2m wide, nose toward -z — the
 * direction of travel in the CircuitGL scene).
 *
 * Everything below the component is module-level and shared: ONE set of
 * geometries and ONE material per role, with livery-tinted materials cached
 * per colour. Four cars on screen share every buffer. The component renders
 * no per-frame React — the ONLY live part is the `spin` handle, which the
 * scene's frame loop drives with each car's true angular wheel speed (the
 * dark rim crossbars are what make the rotation readable; a stopped car's
 * wheels stand still, and reduced motion never calls it at all).
 */

/** Tyre radius in metres — the scene derives angular speed from mph with it. */
export const WHEEL_RADIUS_M = 0.36

export interface F1CarHandle {
  /** Advance all four wheels by `delta` radians (rolling forward). */
  spin(delta: number): void
}

// ---- shared geometry (unit shapes, sized per-mesh via scale) ---------------
const G = {
  box: new BoxGeometry(1, 1, 1),
  /** unit-radius wheel drum; axis along local y, laid onto x by rotation */
  tyre: new CylinderGeometry(0.36, 0.36, 1, 20),
  rim: new CylinderGeometry(0.23, 0.23, 1, 14),
  /** nose cone: tapers from tub cross-section to the tip (local +y = length) */
  nose: new CylinderGeometry(0.07, 0.23, 1, 12),
  helmet: new SphereGeometry(0.15, 18, 14),
  halo: new TorusGeometry(0.3, 0.032, 8, 22),
} as const

// ---- shared, livery-independent materials ----------------------------------
const MAT = {
  carbon: new MeshStandardMaterial({ color: '#1b1d21', roughness: 0.55, metalness: 0.3 }),
  matte: new MeshStandardMaterial({ color: '#101216', roughness: 0.95 }),
  tyre: new MeshStandardMaterial({ color: '#141519', roughness: 0.9 }),
  rim: new MeshStandardMaterial({ color: '#9aa2ae', roughness: 0.3, metalness: 0.8 }),
  halo: new MeshStandardMaterial({ color: '#454c56', roughness: 0.4, metalness: 0.65 }),
  suit: new MeshStandardMaterial({ color: '#23262e', roughness: 0.85 }),
  glove: new MeshStandardMaterial({ color: '#31364a', roughness: 0.8 }),
  white: new MeshStandardMaterial({ color: '#f4f6fa', roughness: 0.35, metalness: 0.1 }),
} as const

// ---- livery-tinted materials, one set per colour, cached -------------------
interface Livery {
  body: MeshStandardMaterial
  helmet: MeshStandardMaterial
  visor: MeshStandardMaterial
}

const liveryCache = new Map<string, Livery>()

function liveryFor(color: string): Livery {
  const hit = liveryCache.get(color)
  if (hit) return hit
  const base = new Color(color)
  const livery: Livery = {
    body: new MeshStandardMaterial({ color: base, roughness: 0.3, metalness: 0.35 }),
    helmet: new MeshStandardMaterial({
      color: base.clone().offsetHSL(0, 0.08, 0.1),
      roughness: 0.25,
      metalness: 0.15,
    }),
    visor: new MeshStandardMaterial({
      color: base.clone().offsetHSL(0, 0.05, -0.18),
      roughness: 0.12,
      metalness: 0.85,
    }),
  }
  liveryCache.set(color, livery)
  return livery
}

// ---- wheels: fronts slightly forward + narrower, rears wider ---------------
// [x, z, tyre width]
const WHEELS: readonly (readonly [number, number, number])[] = [
  [-0.78, -1.5, 0.32],
  [0.78, -1.5, 0.32],
  [-0.82, 1.45, 0.42],
  [0.82, 1.45, 0.42],
]

export const F1Car = forwardRef<F1CarHandle, { color: string; isPlayer: boolean }>(
  function F1Car({ color, isPlayer }, ref,
) {
  const spinGroups = useRef<(Group | null)[]>([null, null, null, null])
  useImperativeHandle(ref, () => ({
    spin(delta) {
      for (const g of spinGroups.current) {
        if (g) g.rotation.y = (g.rotation.y + delta) % (Math.PI * 2)
      }
    },
  }), [])
  const livery = liveryFor(color)
  // the player's car carries white top-surface strips + a white fin — exactly
  // the faces the above-behind chase camera reads
  const trim = isPlayer ? MAT.white : livery.body

  return (
    <group>
      {/* ---- floor + diffuser ---- */}
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.09, 0.1]} scale={[1.5, 0.06, 4.0]} castShadow />
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.18, 2.0]} scale={[1.3, 0.2, 0.45]} rotation={[-0.35, 0, 0]} castShadow />

      {/* ---- monocoque tub + cockpit surround ---- */}
      <mesh geometry={G.box} material={livery.body} position={[0, 0.34, -0.5]} scale={[0.86, 0.34, 2.2]} castShadow />
      <mesh geometry={G.box} material={livery.body} position={[0, 0.54, -0.15]} scale={[0.7, 0.26, 1.2]} castShadow />
      <mesh geometry={G.box} material={MAT.matte} position={[0, 0.675, -0.1]} scale={[0.4, 0.04, 0.8]} />
      {/* mirrors */}
      <mesh geometry={G.box} material={MAT.carbon} position={[-0.42, 0.64, -0.5]} scale={[0.12, 0.06, 0.05]} />
      <mesh geometry={G.box} material={MAT.carbon} position={[0.42, 0.64, -0.5]} scale={[0.12, 0.06, 0.05]} />

      {/* ---- nose cone (tapered, tip toward -z) ---- */}
      <mesh geometry={G.nose} material={livery.body} position={[0, 0.36, -2.08]} scale={[1, 0.95, 0.72]} rotation={[-Math.PI / 2, 0, 0]} castShadow />
      {isPlayer && (
        <mesh geometry={G.box} material={MAT.white} position={[0, 0.475, -1.72]} scale={[0.26, 0.02, 0.5]} />
      )}

      {/* ---- front wing: main plane, flap, endplates ---- */}
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.1, -2.32]} scale={[2.0, 0.04, 0.55]} castShadow />
      <mesh geometry={G.box} material={trim} position={[0, 0.18, -2.16]} scale={[1.9, 0.035, 0.3]} rotation={[-0.3, 0, 0]} castShadow />
      <mesh geometry={G.box} material={livery.body} position={[-1.0, 0.19, -2.32]} scale={[0.04, 0.22, 0.6]} castShadow />
      <mesh geometry={G.box} material={livery.body} position={[1.0, 0.19, -2.32]} scale={[0.04, 0.22, 0.6]} castShadow />

      {/* ---- sidepods with dark intakes ---- */}
      <mesh geometry={G.box} material={livery.body} position={[-0.62, 0.35, 0.45]} scale={[0.42, 0.34, 1.5]} castShadow />
      <mesh geometry={G.box} material={livery.body} position={[0.62, 0.35, 0.45]} scale={[0.42, 0.34, 1.5]} castShadow />
      <mesh geometry={G.box} material={MAT.matte} position={[-0.62, 0.38, -0.32]} scale={[0.34, 0.24, 0.06]} />
      <mesh geometry={G.box} material={MAT.matte} position={[0.62, 0.38, -0.32]} scale={[0.34, 0.24, 0.06]} />
      {/* player strip along each sidepod top */}
      {isPlayer && (
        <>
          <mesh geometry={G.box} material={MAT.white} position={[-0.62, 0.53, 0.45]} scale={[0.3, 0.02, 1.3]} />
          <mesh geometry={G.box} material={MAT.white} position={[0.62, 0.53, 0.45]} scale={[0.3, 0.02, 1.3]} />
        </>
      )}

      {/* ---- airbox + engine-cover spine + shark fin ---- */}
      <mesh geometry={G.box} material={livery.body} position={[0, 0.6, 0.55]} scale={[0.34, 0.44, 0.95]} castShadow />
      <mesh geometry={G.box} material={MAT.matte} position={[0, 0.76, 0.12]} scale={[0.22, 0.16, 0.2]} />
      <mesh geometry={G.box} material={livery.body} position={[0, 0.48, 1.55]} scale={[0.2, 0.3, 1.5]} rotation={[0.06, 0, 0]} castShadow />
      <mesh geometry={G.box} material={trim} position={[0, 0.74, 1.7]} scale={[0.03, 0.26, 0.9]} castShadow />

      {/* ---- rear wing on endplates + beam wing + pillar ---- */}
      <mesh geometry={G.box} material={livery.body} position={[-0.72, 0.88, 2.3]} scale={[0.04, 0.45, 0.65]} castShadow />
      <mesh geometry={G.box} material={livery.body} position={[0.72, 0.88, 2.3]} scale={[0.04, 0.45, 0.65]} castShadow />
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.9, 2.38]} scale={[1.4, 0.04, 0.4]} rotation={[-0.12, 0, 0]} castShadow />
      <mesh geometry={G.box} material={trim} position={[0, 1.02, 2.24]} scale={[1.4, 0.035, 0.26]} rotation={[-0.3, 0, 0]} castShadow />
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.62, 2.32]} scale={[0.07, 0.42, 0.1]} />
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.5, 2.42]} scale={[1.3, 0.04, 0.24]} rotation={[-0.25, 0, 0]} castShadow />
      {/* rain light / crash structure */}
      <mesh geometry={G.box} material={MAT.matte} position={[0, 0.34, 2.42]} scale={[0.1, 0.1, 0.18]} />

      {/* ---- the driver, seated: torso + HANS shoulders, helmet + visor,
           arms in gloves reaching to the wheel, halo hooped over it all.
           Everything sits above the cockpit surround (top y=0.67) so the
           above-behind chase camera reads a person in the car. ---- */}
      <mesh geometry={G.box} material={MAT.suit} position={[0, 0.6, 0.02]} scale={[0.34, 0.24, 0.34]} />
      <mesh geometry={G.box} material={MAT.suit} position={[0, 0.72, 0.05]} scale={[0.44, 0.12, 0.3]} castShadow />
      <mesh geometry={G.helmet} material={livery.helmet} position={[0, 0.86, -0.05]} castShadow />
      <mesh geometry={G.box} material={livery.visor} position={[0, 0.87, -0.17]} scale={[0.2, 0.09, 0.06]} />
      {/* arms angled forward-down from the shoulders to the wheel */}
      <mesh geometry={G.box} material={MAT.suit} position={[-0.15, 0.64, -0.3]} scale={[0.08, 0.08, 0.42]} rotation={[0.35, 0, 0]} />
      <mesh geometry={G.box} material={MAT.suit} position={[0.15, 0.64, -0.3]} scale={[0.08, 0.08, 0.42]} rotation={[0.35, 0, 0]} />
      <mesh geometry={G.box} material={MAT.glove} position={[-0.14, 0.575, -0.48]} scale={[0.09, 0.08, 0.08]} />
      <mesh geometry={G.box} material={MAT.glove} position={[0.14, 0.575, -0.48]} scale={[0.09, 0.08, 0.08]} />
      {/* steering wheel: the rectangular F1 wheel, faces the driver */}
      <mesh geometry={G.box} material={MAT.carbon} position={[0, 0.585, -0.53]} scale={[0.26, 0.13, 0.035]} rotation={[0.4, 0, 0]} />
      {/* halo: titanium hoop around the helmet + the forward pillar */}
      <mesh geometry={G.halo} material={MAT.halo} position={[0, 0.87, -0.05]} scale={[0.88, 1.1, 1]} rotation={[Math.PI / 2, 0, 0]} castShadow />
      <mesh geometry={G.box} material={MAT.halo} position={[0, 0.79, -0.38]} scale={[0.045, 0.05, 0.32]} rotation={[-0.65, 0, 0]} />

      {/* ---- wheels: tyre + brighter rim face, plus a wishbone each ----
           The Rz(π/2) that used to sit on each cylinder now lives on a wrapper
           group, so the inner spin group's local y IS the axle — spin() turns
           it and the dark crossbars strobe across the bright rim face. ---- */}
      {WHEELS.map(([x, z, w], i) => (
        <group key={`${x},${z}`} position={[x, 0.36, z]}>
          <group rotation={[0, 0, Math.PI / 2]}>
            <group ref={(g: Group | null) => { spinGroups.current[i] = g }}>
              <mesh geometry={G.tyre} material={MAT.tyre} scale={[1, w, 1]} castShadow />
              <mesh geometry={G.rim} material={MAT.rim} scale={[1, w + 0.02, 1]} />
              <mesh geometry={G.box} material={MAT.carbon} scale={[0.4, w + 0.06, 0.07]} />
              <mesh geometry={G.box} material={MAT.carbon} scale={[0.07, w + 0.06, 0.4]} />
            </group>
          </group>
          <mesh
            geometry={G.box}
            material={MAT.carbon}
            position={[-x * 0.55, 0.05, 0]}
            scale={[Math.abs(x) * 0.9, 0.035, 0.09]}
            rotation={[0, 0, x > 0 ? 0.12 : -0.12]}
          />
        </group>
      ))}
    </group>
  )
})
