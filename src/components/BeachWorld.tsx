// A romantic beach at sunset — Last Standing's world.
//
// The sun sits ON the waterline and lays a shimmering column straight down the
// ocean toward the table; warm surf lines creep up wet sand; palms lean in from
// both sides; paper lanterns drift over the water. Same cheap techniques as
// SunsetWorld (canvas textures, billboards, faked reflection — no HDRI, no
// reflection pass, no post), tuned rose-and-gold instead of meadow-gold so the
// cabinet's neon pink belongs here.
//
// Everything is positioned off `groundY`, the height of the sand, so the table
// can stand wherever its own floor is. The only per-frame work is the shimmer
// offset, the surf crawl and the lantern bob — all frozen under reduced motion.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BackSide, CanvasTexture, MeshBasicMaterial, RepeatWrapping,
} from 'three'
import type { Group } from 'three'
import { gradientTexture, mulberry32 } from './SunsetWorld'

/** Warm rose haze — the fog AND the air the horizon dissolves into. */
export const BEACH_HAZE = '#eda07f'
export const BEACH_FOG: [string, number, number] = [BEACH_HAZE, 26, 210]
const SUN_POS: readonly [number, number, number] = [-6, 3.4, -150]

function makeSkyTexture(): CanvasTexture {
  return gradientTexture(1, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#241a4e') // deep violet overhead
    g.addColorStop(0.14, '#3c2260')
    g.addColorStop(0.26, '#67306a')
    g.addColorStop(0.36, '#9b3c6b')
    g.addColorStop(0.43, '#c74f6a')
    g.addColorStop(0.475, '#e86f5e')
    g.addColorStop(0.5, '#fb9a5f') // the waterline blaze
    g.addColorStop(0.52, '#ffc07d')
    g.addColorStop(0.55, '#ffdca6')
    // below the horizon the dome cools to the sea it meets, hiding the seam
    g.addColorStop(0.62, '#c98a86')
    g.addColorStop(0.8, '#8a5f80')
    g.addColorStop(1, '#5e3f6b')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1, 512)
  })
}

function makeGlowTexture(): CanvasTexture {
  return gradientTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,236,198,0.95)')
    g.addColorStop(0.22, 'rgba(255,186,132,0.5)')
    g.addColorStop(0.55, 'rgba(255,140,110,0.16)')
    g.addColorStop(1, 'rgba(255,120,110,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  })
}

function makeHaloTexture(): CanvasTexture {
  return gradientTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,250,228,1)')
    g.addColorStop(0.36, 'rgba(255,232,186,0.9)')
    g.addColorStop(0.5, 'rgba(255,190,140,0.42)')
    g.addColorStop(1, 'rgba(255,150,120,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  })
}

/** Sea: blazing gold at the sun's line, cooling to violet at our feet. */
function makeOceanTexture(): CanvasTexture {
  return gradientTexture(8, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, 'rgba(255,222,164,1)') // horizon, sun-struck
    g.addColorStop(0.14, 'rgba(248,166,116,1)')
    g.addColorStop(0.36, 'rgba(196,106,116,1)')
    g.addColorStop(0.62, 'rgba(120,72,124,1)')
    g.addColorStop(0.85, 'rgba(72,52,110,1)')
    g.addColorStop(1, 'rgba(58,44,96,1)') // shore break
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 8, 256)
  })
}

/** The sun's reflection column crawling up the water toward the beach. */
function makeShimmerTexture(): CanvasTexture {
  const tex = gradientTexture(64, 256, (ctx) => {
    const rnd = mulberry32(19)
    for (let i = 0; i < 44; i++) {
      const y = rnd() * 256
      const near = y / 256 // 0 = at the sun, 1 = at our feet
      const w = 6 + rnd() * (14 + near * 40)
      const a = (0.95 - near * 0.6) * (0.45 + rnd() * 0.55)
      ctx.fillStyle = `rgba(255,${230 - near * 46 | 0},${176 - near * 40 | 0},${a.toFixed(3)})`
      ctx.fillRect(32 - w / 2 + (rnd() - 0.5) * (8 + near * 30), y, w, 1.4 + rnd() * 2.2)
    }
  })
  tex.wrapT = RepeatWrapping
  return tex
}

/** Soft foam lines — repeated up the shore so the surf reads as moving water. */
function makeFoamTexture(): CanvasTexture {
  const tex = gradientTexture(256, 256, (ctx) => {
    ctx.filter = 'blur(3px)'
    const rnd = mulberry32(5)
    for (const y of [34, 96, 158, 220]) {
      ctx.strokeStyle = `rgba(255,241,226,${(0.5 + rnd() * 0.3).toFixed(2)})`
      ctx.lineWidth = 3 + rnd() * 3
      ctx.beginPath()
      for (let x = 0; x <= 256; x += 16) {
        const wobble = Math.sin((x / 256) * Math.PI * 3 + y) * 5
        if (x === 0) ctx.moveTo(x, y + wobble)
        else ctx.lineTo(x, y + wobble)
      }
      ctx.stroke()
    }
    ctx.filter = 'none'
  })
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  return tex
}

/** Warm dry sand out at the table, damp and sky-lit toward the water. */
function makeSandTexture(): CanvasTexture {
  return gradientTexture(512, 512, (ctx) => {
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 280)
    g.addColorStop(0, '#e8cba0')
    g.addColorStop(0.4, '#dcbc90')
    g.addColorStop(0.75, '#c79a78')
    g.addColorStop(1, '#a87a70')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    const rnd = mulberry32(33)
    ctx.filter = 'blur(4px)'
    for (let i = 0; i < 80; i++) {
      const x = rnd() * 512
      const y = rnd() * 512
      const r = 6 + rnd() * 26
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(180,142,104,0.22)' : 'rgba(255,232,198,0.20)'
      ctx.beginPath()
      ctx.ellipse(x, y, r * (1 + rnd()), r * 0.55, rnd() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.filter = 'none'
    // scattered shells catching the last light
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(255,246,232,0.5)'
      ctx.beginPath()
      ctx.ellipse(rnd() * 512, rnd() * 512, 2.5 + rnd() * 2, 1.6 + rnd(), rnd() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** Backlit palm silhouettes: a leaning trunk under a crown of drooping fronds. */
function makePalmTexture(variant: 0 | 1): CanvasTexture {
  return gradientTexture(256, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#4a2f36') // faint warm rim where the sky grazes the crown
    g.addColorStop(0.55, '#2e1d28')
    g.addColorStop(1, '#20141d')
    ctx.fillStyle = g
    ctx.strokeStyle = g as unknown as string
    const lean = variant === 0 ? 26 : -20
    // trunk: a tapering curve, not a rectangle
    ctx.beginPath()
    ctx.moveTo(128 - 13, 512)
    ctx.quadraticCurveTo(128 - 6 + lean * 0.5, 330, 128 + lean, 176)
    ctx.lineTo(128 + lean + 11, 176)
    ctx.quadraticCurveTo(128 + 8 + lean * 0.5, 330, 128 + 13, 512)
    ctx.closePath()
    ctx.fill()
    // fronds radiating from the crown, each a drooping tapered leaf
    const cx = 128 + lean + 5
    const cy = 172
    const angles = variant === 0
      ? [-2.75, -2.2, -1.75, -1.25, -0.55, -0.1, 0.45, 1.0]
      : [-3.0, -2.45, -1.95, -1.4, -0.8, -0.3, 0.3, 0.9]
    for (const a of angles) {
      const len = 86 + Math.abs(Math.cos(a)) * 44
      const tipX = cx + Math.cos(a) * len
      const tipY = cy + Math.sin(a) * len + 34 // gravity droop
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(cx + Math.cos(a) * len * 0.55, cy + Math.sin(a) * len * 0.5 - 12, tipX, tipY)
      ctx.quadraticCurveTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 + 16, cx, cy + 10)
      ctx.closePath()
      ctx.fill()
    }
    // a couple of coconuts for the silhouette to read as a palm
    ctx.beginPath()
    ctx.arc(cx - 9, cy + 15, 6, 0, Math.PI * 2)
    ctx.arc(cx + 7, cy + 18, 5.5, 0, Math.PI * 2)
    ctx.fill()
  })
}

// Palms framing the view, well clear of the sun/reflection corridor down the
// middle: [x, z, height, variant].
const PALMS: readonly (readonly [number, number, number, 0 | 1])[] = [
  [-15, 2, 12, 0], [15, 1, 13, 1], // near pair, framing the camera's edges
  [-23, -10, 15, 1], [23, -12, 16, 0],
  [-35, -24, 17, 0], [35, -26, 18, 1],
  [-52, -40, 16, 1], [54, -38, 15, 0],
]
const PALM_W = [0.78, 0.72] as const

/** Paper lanterns drifting over the water — the romance, and the only warm
 *  light source that is not the sun. */
const LANTERNS: readonly (readonly [number, number, number, number])[] = [
  [-16, 7.5, -34, 1.0], [-7, 10.5, -48, 0.8], [5, 8.2, -30, 1.1],
  [14, 12.0, -52, 0.85], [-25, 13.0, -60, 0.9], [22, 9.4, -40, 0.95],
  [-2, 14.5, -68, 0.75], [31, 15.0, -74, 0.8],
]

function Lanterns({ reduced, glowTex }: { reduced: boolean; glowTex: CanvasTexture }) {
  const groupRef = useRef<Group>(null)
  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group || reduced) return
    const t = clock.elapsedTime
    group.children.forEach((lantern, i) => {
      lantern.position.y = LANTERNS[i][1] + Math.sin(t * 0.36 + i * 1.3) * 0.55
      lantern.position.x = LANTERNS[i][0] + Math.sin(t * 0.13 + i * 2.1) * 0.9
    })
  })
  return (
    <group ref={groupRef}>
      {LANTERNS.map(([x, y, z, s], i) => (
        <group key={i} position={[x, y, z]} scale={s}>
          <mesh>
            <planeGeometry args={[7, 7]} />
            <meshBasicMaterial map={glowTex} transparent blending={AdditiveBlending} opacity={0.7} fog={false} toneMapped={false} depthWrite={false} />
          </mesh>
          {/* the paper body itself, lit from within */}
          <mesh>
            <sphereGeometry args={[0.42, 10, 8]} />
            <meshBasicMaterial color="#ffcf92" fog={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** The light rig for this beach: violet sky above, warm sand bounce below, the
 *  low sun as a rose-gold key from across the water, and a soft camera-side
 *  fill so faces at the table stay readable. */
export function BeachLights() {
  return (
    <>
      <hemisphereLight args={['#8f6ab5', '#c99a72', 0.9]} />
      <directionalLight
        position={[-10, 6, -40]}
        intensity={2.6}
        color="#ffb083"
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
      <directionalLight position={[5, 7, 13]} intensity={0.75} color="#ffd2c6" />
    </>
  )
}

/** Sky, sun, ocean, surf, sand, palms and lanterns — the whole beach. */
export function BeachWorld({ reduced, groundY }: { reduced: boolean; groundY: number }) {
  const skyTex = useMemo(makeSkyTexture, [])
  const glowTex = useMemo(makeGlowTexture, [])
  const haloTex = useMemo(makeHaloTexture, [])
  const oceanTex = useMemo(makeOceanTexture, [])
  const shimmerTex = useMemo(makeShimmerTexture, [])
  const foamTex = useMemo(makeFoamTexture, [])
  const sandTex = useMemo(makeSandTexture, [])
  const palmMats = useMemo(() => ([0, 1] as const).map((v) =>
    new MeshBasicMaterial({ map: makePalmTexture(v), alphaTest: 0.5 })), [])

  useEffect(() => () => {
    skyTex.dispose(); glowTex.dispose(); haloTex.dispose(); oceanTex.dispose()
    shimmerTex.dispose(); foamTex.dispose(); sandTex.dispose()
    for (const m of palmMats) { m.map?.dispose(); m.dispose() }
  }, [skyTex, glowTex, haloTex, oceanTex, shimmerTex, foamTex, sandTex, palmMats])

  useFrame((_, dt) => {
    if (reduced) return
    shimmerTex.offset.y -= dt * 0.02 // glints crawl toward the shore
    foamTex.offset.y -= dt * 0.05 // surf runs up the sand
  })

  const seaY = groundY - 0.16 // the water sits just below the sand line

  return (
    <group>
      {/* sky dome — the gradient IS the final colour: no fog, no tone map */}
      <mesh>
        <sphereGeometry args={[300, 24, 24]} />
        <meshBasicMaterial map={skyTex} side={BackSide} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* the sun, half-drowned on the waterline */}
      <group position={[SUN_POS[0], SUN_POS[1], SUN_POS[2]]}>
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[110, 110]} />
          <meshBasicMaterial map={glowTex} transparent fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh>
          <circleGeometry args={[7.2, 48]} />
          <meshBasicMaterial color="#fff3d2" fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, 0.5]}>
          <planeGeometry args={[34, 34]} />
          <meshBasicMaterial map={haloTex} transparent blending={AdditiveBlending} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>

      {/* distant headland, so the horizon is not a dead straight line */}
      <mesh position={[-88, seaY + 2.4, -196]}>
        <planeGeometry args={[130, 7]} />
        <meshBasicMaterial color="#6b4468" transparent opacity={0.75} fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[104, seaY + 1.9, -188]}>
        <planeGeometry args={[110, 5.5]} />
        <meshBasicMaterial color="#7a4c6a" transparent opacity={0.6} fog={false} toneMapped={false} />
      </mesh>

      {/* the ocean: one big gradient plane running to the horizon */}
      <mesh position={[0, seaY, -140]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[560, 250]} />
        <meshBasicMaterial map={oceanTex} fog={false} toneMapped={false} />
      </mesh>
      {/* the sun's reflection column, laid straight down the water to us */}
      <mesh position={[SUN_POS[0], seaY + 0.04, -110]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 180]} />
        <meshBasicMaterial map={shimmerTex} transparent blending={AdditiveBlending} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* surf: foam lines creeping up the wet sand */}
      <mesh position={[0, seaY + 0.06, -17]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[300, 12]} />
        <meshBasicMaterial map={foamTex} transparent opacity={0.55} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* wet-sand sheen where the water has just pulled back */}
      <mesh position={[0, groundY - 0.19, -13]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[300, 10]} />
        <meshBasicMaterial color="#e7b294" transparent opacity={0.45} fog={false} toneMapped={false} />
      </mesh>

      {/* the beach the table stands on */}
      <mesh position={[0, groundY - 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[260, 48]} />
        <meshStandardMaterial map={sandTex} roughness={1} />
      </mesh>

      {/* palms leaning in from both sides */}
      {PALMS.map(([x, z, h, v], i) => (
        <mesh key={i} position={[x, groundY - 0.2 + h / 2, z]} scale={[h * PALM_W[v], h, 1]}>
          <planeGeometry args={[1, 1]} />
          <primitive object={palmMats[v]} attach="material" />
        </mesh>
      ))}

      <Lanterns reduced={reduced} glowTex={glowTex} />
    </group>
  )
}
