// The shared golden-hour environment: a hand-tuned sunset gradient dome (no
// HDRI, no post), a low sun disc with a cheap billboard glow, silhouetted
// hills, a lake whose "reflection" is a gradient streak plane, a backlit tree
// line and a rolling meadow. Warm fog carries the haze; the dome itself is
// never fogged or tone-mapped.
//
// Extracted from CardTable3D when Last Standing took the same world — the card
// table keeps its wooden deck (`deck`), Last Standing sits straight on the
// meadow. Everything is positioned relative to `groundY` so each table can put
// the horizon where its own floor sits.
//
// Cost note: every texture here is a one-off CanvasTexture built at mount and
// disposed on unmount; the only per-frame work is the cloud sway and the lake
// shimmer offset, both frozen under reduced motion.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BackSide, CanvasTexture, MeshBasicMaterial, RepeatWrapping, SRGBColorSpace,
} from 'three'
import type { Group } from 'three'

export const HAZE = '#f0a066' // warm atmospheric haze — the fog AND the horizon band
export const SUN_POS: readonly [number, number, number] = [-11, 5.6, -95]

/** Fog args for a scene using this world — `<fog attach="fog" args={SUNSET_FOG} />`.
 *  The dome radius is 300, so a camera far plane below ~400 will clip the sky.
 *  Not `readonly`: r3f's fog args expect a mutable tuple. */
export const SUNSET_FOG: [string, number, number] = [HAZE, 28, 215]

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
export function mulberry32(seed: number): () => number {
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

/** The golden-hour light rig that belongs with this world: a dusk-sky fill from
 *  above with warm ground bounce, the sun as a low warm key from behind the
 *  table (long shadows toward the camera), and a soft camera-side fill so faces
 *  stay readable. */
export function SunsetLights() {
  return (
    <>
      <hemisphereLight args={['#9a7fc0', '#7a5638', 0.85]} />
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
      <directionalLight position={[4, 7, 14]} intensity={0.7} color="#ffd9c0" />
    </>
  )
}

/** Sky dome, sun, hills, lake, grass — everything around the table.
 *  `groundY` is where the meadow sits; `deck` adds the card table's wooden
 *  platform (Last Standing stands straight on the grass). */
export function SunsetWorld({ reduced, groundY, deck = false }: {
  reduced: boolean
  groundY: number
  deck?: boolean
}) {
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
      <mesh position={[0, groundY - 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[280, 48]} />
        <meshStandardMaterial map={groundTex} roughness={1} />
      </mesh>
      {/* lake catching the sun — a gradient disc (blazing at the far shore,
          cooling toward us) + the sun's shimmering reflection column: a faked
          reflection, no passes */}
      <group position={[-9, groundY - 0.14, -108]}>
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
        <mesh key={i} position={[x, groundY - 0.2 + h / 2, z]} scale={[h * TREE_W[v], h, 1]}>
          <planeGeometry args={[1, 1]} />
          <primitive object={treeMats[v]} attach="material" />
        </mesh>
      ))}
      {/* the wooden deck the card table sits on */}
      {deck && (
        <mesh position={[0, groundY - 0.09, 0]} receiveShadow>
          <cylinderGeometry args={[7.4, 7.4, 0.18, 40]} />
          <meshStandardMaterial map={deckTex} color="#c9a377" roughness={0.85} />
        </mesh>
      )}
    </group>
  )
}
