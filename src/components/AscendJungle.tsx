// The living Amazon around Ascend's board — environment only, no gameplay.
// A mossy clearing floor and stone plinth, ringed layers of instanced foliage
// (ferns and broadleaves at the clearing edge, palms/vines mid-ring, tall
// fog-eaten trunks far out), a half-closed canopy with additive god-ray
// shafts, and ambient life: fireflies, pollen motes, butterflies, drifting
// ground mist, and slowly swaying hero leaves. Everything is procedural
// (canvas textures + primitives) — no external assets — and every repeated
// element is an InstancedMesh with matrices built once per mount.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import {
  AdditiveBlending, CanvasTexture, CylinderGeometry, DoubleSide, Euler,
  IcosahedronGeometry, Matrix4, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three'
import type { BufferGeometry, Group, InstancedMesh, Material, Mesh } from 'three'
import { hash01 } from '../lib/ascendBoardTexture'

const GROUND_Y = -0.4 // forest floor sits below the board plinth
const SUN_DIR = new Vector3(5, 12, 3).normalize() // matches the key light

// ---- canvas textures ---------------------------------------------------------

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx) draw(ctx)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** Mossy leaf-littered ground, tileable enough once fog and clutter sit on it. */
function paintFloor(ctx: CanvasRenderingContext2D): void {
  const s = 512
  ctx.fillStyle = '#2c3a1c'
  ctx.fillRect(0, 0, s, s)
  const patch = ['#33441f', '#243218', '#3a4a24', '#2f3d1a']
  ctx.globalAlpha = 0.4
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = patch[i % patch.length]
    ctx.beginPath()
    ctx.ellipse(hash01(i, 1) * s, hash01(i, 2) * s, 12 + hash01(i, 3) * 42, 8 + hash01(i, 4) * 30, hash01(i, 5) * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.75
  const litter = ['#6b5a2e', '#7a6a35', '#4a5a26', '#84582e', '#5c4a24']
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = litter[i % litter.length]
    ctx.save()
    ctx.translate(hash01(i, 11) * s, hash01(i, 12) * s)
    ctx.rotate(hash01(i, 13) * Math.PI)
    ctx.beginPath()
    ctx.ellipse(0, 0, 2.5 + hash01(i, 14) * 4.5, 1.2 + hash01(i, 15) * 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#55702f'
  for (let i = 0; i < 320; i++) {
    ctx.fillRect(hash01(i, 21) * s, hash01(i, 22) * s, 1.6, 1.6)
  }
  ctx.globalAlpha = 1
}

/** Fern silhouette: fronds fanning up from the base, leaflets along each. */
function paintFern(ctx: CanvasRenderingContext2D): void {
  const bx = 128
  const by = 252
  ctx.lineCap = 'round'
  for (let f = 0; f < 8; f++) {
    const theta = (-1.15 + (2.3 * f) / 7) + (hash01(f, 1) - 0.5) * 0.15
    const len = 150 + hash01(f, 2) * 90
    const bend = (hash01(f, 3) - 0.5) * 70
    const tone = 0.75 + hash01(f, 4) * 0.5
    ctx.strokeStyle = `rgb(${Math.round(52 * tone)}, ${Math.round(96 * tone)}, ${Math.round(36 * tone)})`
    ctx.lineWidth = 3
    let px = bx
    let py = by
    ctx.beginPath()
    ctx.moveTo(px, py)
    for (let k = 1; k <= 14; k++) {
      const t = k / 14
      const x = bx + Math.sin(theta) * len * t + bend * t * t
      const y = by - Math.cos(theta) * len * t
      ctx.lineTo(x, y)
      // leaflets: short perpendicular strokes, tapering to the tip
      const ll = (1 - t) * 16 + 2
      const nx = Math.cos(theta)
      const ny = Math.sin(theta)
      ctx.moveTo(x - nx * ll, y - ny * ll)
      ctx.lineTo(x + nx * ll, y + ny * ll)
      ctx.moveTo(x, y)
      px = x
      py = y
    }
    ctx.lineTo(px, py)
    ctx.stroke()
  }
}

/** Big split broadleaf (monstera-style): blob + veins, wedges cut from the rim. */
function paintBroadleaf(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(128, 110, 15, 128, 110, 110)
  g.addColorStop(0, '#3f7030')
  g.addColorStop(1, '#2b5220')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(128, 112, 96, 104, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3a5a26'
  ctx.fillRect(124, 200, 8, 56)
  ctx.strokeStyle = 'rgba(120, 165, 90, 0.55)'
  ctx.lineWidth = 2.5
  for (let v = 0; v < 9; v++) {
    const a = -Math.PI * 0.92 + (Math.PI * 0.84 * v) / 8
    ctx.beginPath()
    ctx.moveTo(128, 190)
    ctx.quadraticCurveTo(128 + Math.sin(a) * 45, 130, 128 + Math.sin(a) * 92, 112 + Math.cos(a) * -70)
    ctx.stroke()
  }
  // monstera splits: erase thin wedges from the rim toward the midrib
  ctx.globalCompositeOperation = 'destination-out'
  for (let v = 0; v < 6; v++) {
    const side = v % 2 === 0 ? 1 : -1
    const y = 50 + v * 26
    ctx.beginPath()
    ctx.moveTo(128 + side * 110, y)
    ctx.lineTo(128 + side * 26, y + 9)
    ctx.lineTo(128 + side * 110, y + 20)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

/** Palm crown, side view: fronds arching out and drooping from one point. */
function paintPalmCrown(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = 'round'
  for (let f = 0; f < 11; f++) {
    const a = -1.45 + (2.9 * f) / 10
    const len = 105 + hash01(f, 6) * 30
    const tone = 0.8 + hash01(f, 7) * 0.4
    ctx.strokeStyle = `rgb(${Math.round(56 * tone)}, ${Math.round(96 * tone)}, ${Math.round(38 * tone)})`
    ctx.lineWidth = 7
    const ex = 128 + Math.sin(a) * len
    const ey = 205 - Math.cos(a) * len * 0.55 + Math.abs(Math.sin(a)) * 55
    ctx.beginPath()
    ctx.moveTo(128, 205)
    ctx.quadraticCurveTo(128 + Math.sin(a) * len * 0.55, 205 - Math.cos(a) * len * 0.8 - 30, ex, ey)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex + Math.sin(a) * 26, ey + 30)
    ctx.stroke()
  }
}

/** Hanging vines: wavy strands with little leaves. */
function paintVine(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = 'round'
  for (let v = 0; v < 3; v++) {
    const x0 = 24 + v * 40 + (hash01(v, 8) - 0.5) * 14
    ctx.strokeStyle = v === 1 ? '#465c28' : '#3e5424'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(x0, 0)
    ctx.bezierCurveTo(x0 + 18, 80, x0 - 18, 170, x0 + (hash01(v, 9) - 0.5) * 26, 256)
    ctx.stroke()
    ctx.fillStyle = '#4e6b2c'
    for (let l = 0; l < 9; l++) {
      const t = (l + 0.5) / 9
      const lx = x0 + Math.sin(t * Math.PI * 2) * 16 + (l % 2 === 0 ? 8 : -8)
      ctx.beginPath()
      ctx.ellipse(lx, t * 256, 6, 3.4, l % 2 === 0 ? 0.6 : -0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Canopy pad: cluster of dark leaf blobs with sky gaps. */
function paintCanopy(ctx: CanvasRenderingContext2D): void {
  const tones = ['#1c3313', '#254419', '#2e5220', '#213c16']
  for (let b = 0; b < 15; b++) {
    const cx = 30 + hash01(b, 31) * 196
    const cy = 30 + hash01(b, 32) * 196
    ctx.fillStyle = tones[b % tones.length]
    ctx.globalAlpha = 0.95
    for (let k = 0; k < 5; k++) {
      ctx.beginPath()
      ctx.ellipse(
        cx + (hash01(b, 40 + k) - 0.5) * 44, cy + (hash01(b, 50 + k) - 0.5) * 44,
        16 + hash01(b, 60 + k) * 24, 12 + hash01(b, 70 + k) * 18,
        hash01(b, 80 + k) * Math.PI, 0, Math.PI * 2,
      )
      ctx.fill()
    }
  }
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#40632a'
  for (let b = 0; b < 24; b++) {
    ctx.beginPath()
    ctx.ellipse(hash01(b, 91) * 256, hash01(b, 92) * 256, 7 + hash01(b, 93) * 9, 5, hash01(b, 94) * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Soft radial blob for the drifting ground mist. */
function paintMist(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126)
  g.addColorStop(0, 'rgba(255, 255, 255, 0.85)')
  g.addColorStop(0.55, 'rgba(255, 255, 255, 0.3)')
  g.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
}

// ---- instanced placement -----------------------------------------------------

const POS = new Vector3()
const EUL = new Euler()
const QUAT = new Quaternion()
const SCL = new Vector3()

function compose(x: number, y: number, z: number, tilt: number, yaw: number, sx: number, sy: number, sz: number): Matrix4 {
  POS.set(x, y, z)
  EUL.set(tilt, yaw, 0, 'YXZ')
  QUAT.setFromEuler(EUL)
  SCL.set(sx, sy, sz)
  return new Matrix4().compose(POS, QUAT, SCL)
}

interface RingCfg {
  seed: number
  count: number
  rMin: number
  rMax: number
  yMin: number
  yMax: number
  sMin: number
  sMax: number
  /** vertical scale range for trunks; uniform `s` when omitted */
  hMin?: number
  hMax?: number
  faceCenter?: boolean
  lieFlat?: boolean
  cross?: boolean
}

/** Deterministic ring of instance matrices around the clearing. */
function ringMatrices(c: RingCfg): Matrix4[] {
  const out: Matrix4[] = []
  for (let i = 0; i < c.count; i++) {
    const a = ((i + 0.7 * hash01(c.seed, i * 7 + 1)) / c.count) * Math.PI * 2
    const r = c.rMin + hash01(c.seed, i * 7 + 2) * (c.rMax - c.rMin)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const y = c.yMin + hash01(c.seed, i * 7 + 3) * (c.yMax - c.yMin)
    const s = c.sMin + hash01(c.seed, i * 7 + 4) * (c.sMax - c.sMin)
    const sy = c.hMin !== undefined && c.hMax !== undefined
      ? c.hMin + hash01(c.seed, i * 7 + 6) * (c.hMax - c.hMin)
      : s
    const yaw = c.faceCenter
      ? Math.atan2(-x, -z) + (hash01(c.seed, i * 7 + 5) - 0.5) * 0.9
      : hash01(c.seed, i * 7 + 5) * Math.PI * 2
    const tilt = c.lieFlat
      ? -Math.PI / 2 + (hash01(c.seed, i * 7 + 8) - 0.5) * 0.5
      : (hash01(c.seed, i * 7 + 8) - 0.5) * 0.14
    out.push(compose(x, y, z, tilt, yaw, s, sy, s))
    if (c.cross) out.push(compose(x, y, z, tilt, yaw + Math.PI / 2, s, sy, s))
  }
  return out
}

/** Palms share x/z between trunk and two crossed crown planes at the trunk top. */
function palmMatrices(seed: number, count: number, rMin: number, rMax: number): { trunks: Matrix4[]; crowns: Matrix4[] } {
  const trunks: Matrix4[] = []
  const crowns: Matrix4[] = []
  for (let i = 0; i < count; i++) {
    const a = ((i + 0.7 * hash01(seed, i * 9 + 1)) / count) * Math.PI * 2
    const r = rMin + hash01(seed, i * 9 + 2) * (rMax - rMin)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const h = 4.6 + hash01(seed, i * 9 + 3) * 3.2
    const lean = (hash01(seed, i * 9 + 4) - 0.5) * 0.16
    const yaw = hash01(seed, i * 9 + 5) * Math.PI * 2
    trunks.push(compose(x, GROUND_Y, z, lean, yaw, 0.17 + hash01(seed, i * 9 + 6) * 0.08, h, 0.17 + hash01(seed, i * 9 + 6) * 0.08))
    const cs = 1.35 + hash01(seed, i * 9 + 7) * 0.6
    const cy = GROUND_Y + h * 0.96
    crowns.push(compose(x, cy, z, 0, yaw, cs, cs, cs))
    crowns.push(compose(x, cy, z, 0, yaw + Math.PI / 2, cs, cs, cs))
  }
  return { trunks, crowns }
}

function Instanced({ geo, mat, matrices, shadow = false }: {
  geo: BufferGeometry
  mat: Material
  matrices: Matrix4[]
  shadow?: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    matrices.forEach((mm, i) => m.setMatrixAt(i, mm))
    m.instanceMatrix.needsUpdate = true
  }, [matrices])
  return (
    <instancedMesh ref={ref} args={[geo, mat, matrices.length]}
      frustumCulled={false} castShadow={shadow} />
  )
}

// ---- ambient life ------------------------------------------------------------

interface ButterflyPath {
  cx: number
  cz: number
  y: number
  rx: number
  rz: number
  w: number
  ph: number
}

function Butterfly({ i, reduced, wingGeo, wingMat, bodyMat }: {
  i: number
  reduced: boolean
  wingGeo: BufferGeometry
  wingMat: Material
  bodyMat: Material
}) {
  const g = useRef<Group>(null)
  const left = useRef<Group>(null)
  const right = useRef<Group>(null)
  const p = useMemo<ButterflyPath>(() => ({
    cx: (hash01(i, 201) - 0.5) * 5,
    cz: (hash01(i, 202) - 0.5) * 5,
    y: 1.2 + hash01(i, 203) * 1.6,
    rx: 4.2 + hash01(i, 204) * 2.6,
    rz: 4.2 + hash01(i, 205) * 2.6,
    w: 0.14 + hash01(i, 206) * 0.1,
    ph: hash01(i, 207) * Math.PI * 2,
  }), [i])
  useFrame(({ clock }) => {
    const grp = g.current
    if (reduced || !grp) return
    const t = clock.elapsedTime
    const a = t * p.w + p.ph
    grp.position.set(p.cx + Math.cos(a) * p.rx, p.y + Math.sin(t * 1.6 + p.ph) * 0.35, p.cz + Math.sin(a) * p.rz)
    grp.rotation.y = Math.atan2(-Math.sin(a) * p.rx, Math.cos(a) * p.rz)
    const flap = Math.sin(t * 9 + p.ph) * 0.95
    if (left.current) left.current.rotation.z = flap
    if (right.current) right.current.rotation.z = flap
  })
  return (
    <group ref={g} position={[p.cx + p.rx * Math.cos(p.ph), p.y, p.cz + p.rz * Math.sin(p.ph)]}>
      <mesh material={bodyMat}>
        <boxGeometry args={[0.035, 0.035, 0.18]} />
      </mesh>
      <group ref={left}>
        <mesh geometry={wingGeo} material={wingMat} />
      </group>
      <group ref={right} rotation={[0, Math.PI, 0]}>
        <mesh geometry={wingGeo} material={wingMat} />
      </group>
    </group>
  )
}

// ---- the environment ---------------------------------------------------------

interface JungleAssets {
  textures: CanvasTexture[]
  materials: Material[]
  geometries: BufferGeometry[]
  floorMat: MeshStandardMaterial
  plinthMat: MeshStandardMaterial
  rockMat: MeshStandardMaterial
  fernMat: MeshStandardMaterial
  broadleafMat: MeshStandardMaterial
  crownMat: MeshStandardMaterial
  vineMat: MeshStandardMaterial
  canopyMat: MeshStandardMaterial
  trunkMat: MeshStandardMaterial
  farTrunkMat: MeshStandardMaterial
  shaftMat: MeshBasicMaterial
  mistMat: MeshBasicMaterial
  wingMatA: MeshStandardMaterial
  wingMatB: MeshStandardMaterial
  bodyMat: MeshStandardMaterial
  planeGeo: PlaneGeometry
  fernGeo: PlaneGeometry
  leafGeo: PlaneGeometry
  crownGeo: PlaneGeometry
  vineGeo: PlaneGeometry
  trunkGeo: CylinderGeometry
  rockGeo: IcosahedronGeometry
  shaftGeo: CylinderGeometry
  mistGeo: PlaneGeometry
  wingGeo: PlaneGeometry
  ferns: Matrix4[]
  broadleaves: Matrix4[]
  palms: { trunks: Matrix4[]; crowns: Matrix4[] }
  vines: Matrix4[]
  farTrunks: Matrix4[]
  canopy: Matrix4[]
  rocks: Matrix4[]
  shaftQuat: Quaternion
  heroes: { x: number; z: number; yaw: number; s: number; ph: number }[]
  mists: { x: number; z: number; ph: number }[]
}

function buildJungle(): JungleAssets {
  const floorTex = canvasTex(512, 512, paintFloor)
  floorTex.wrapS = floorTex.wrapT = RepeatWrapping
  floorTex.repeat.set(7, 7)
  const fernTex = canvasTex(256, 256, paintFern)
  const broadleafTex = canvasTex(256, 256, paintBroadleaf)
  const crownTex = canvasTex(256, 256, paintPalmCrown)
  const vineTex = canvasTex(128, 256, paintVine)
  const canopyTex = canvasTex(256, 256, paintCanopy)
  const mistTex = canvasTex(256, 256, paintMist)

  const leafMat = (tex: CanvasTexture): MeshStandardMaterial => new MeshStandardMaterial({
    map: tex, alphaTest: 0.4, side: DoubleSide, roughness: 0.9,
    emissive: '#141f0c', emissiveIntensity: 0.6,
  })
  const floorMat = new MeshStandardMaterial({ map: floorTex, roughness: 1 })
  const plinthMat = new MeshStandardMaterial({ color: '#525c46', roughness: 0.95 })
  const rockMat = new MeshStandardMaterial({ color: '#5a6150', roughness: 0.95, flatShading: true })
  const fernMat = leafMat(fernTex)
  const broadleafMat = leafMat(broadleafTex)
  const crownMat = leafMat(crownTex)
  const vineMat = leafMat(vineTex)
  const canopyMat = leafMat(canopyTex)
  const trunkMat = new MeshStandardMaterial({ color: '#4a3b26', roughness: 1 })
  const farTrunkMat = new MeshStandardMaterial({ color: '#3a3324', roughness: 1 })
  const shaftMat = new MeshBasicMaterial({
    color: '#ffe9b0', transparent: true, opacity: 0.07,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
  })
  const mistMat = new MeshBasicMaterial({
    map: mistTex, color: '#dcead0', transparent: true, opacity: 0.11, depthWrite: false,
  })
  const wingMatA = new MeshStandardMaterial({ color: '#3b6fd4', side: DoubleSide, roughness: 0.6, emissive: '#16294f', emissiveIntensity: 0.8 })
  const wingMatB = new MeshStandardMaterial({ color: '#e08a2e', side: DoubleSide, roughness: 0.6, emissive: '#4f2c0e', emissiveIntensity: 0.8 })
  const bodyMat = new MeshStandardMaterial({ color: '#2a2118', roughness: 0.8 })

  const planeGeo = new PlaneGeometry(70, 70)
  const fernGeo = new PlaneGeometry(1, 0.85)
  fernGeo.translate(0, 0.425, 0)
  const leafGeo = new PlaneGeometry(1, 1)
  leafGeo.translate(0, 0.5, 0)
  const crownGeo = new PlaneGeometry(4.4, 3.4)
  crownGeo.translate(0, 1.2, 0)
  const vineGeo = new PlaneGeometry(1.2, 6)
  vineGeo.translate(0, -3, 0)
  const trunkGeo = new CylinderGeometry(0.8, 1.05, 1, 7)
  trunkGeo.translate(0, 0.5, 0)
  const rockGeo = new IcosahedronGeometry(1, 1)
  const shaftGeo = new CylinderGeometry(0.35, 2.3, 11, 10, 1, true)
  const mistGeo = new PlaneGeometry(12, 12)
  const wingGeo = new PlaneGeometry(0.3, 0.2)
  wingGeo.rotateX(-Math.PI / 2)
  wingGeo.translate(0.17, 0, 0)

  const shaftQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), SUN_DIR)

  const heroes = [0.55, 1.9, 3.55, 5.15].map((a, i) => ({
    x: Math.cos(a) * (9.9 + hash01(i, 301) * 0.7),
    z: Math.sin(a) * (9.9 + hash01(i, 302) * 0.7),
    yaw: Math.atan2(-Math.cos(a), -Math.sin(a)),
    s: 2.9 + hash01(i, 303) * 0.8,
    ph: hash01(i, 304) * Math.PI * 2,
  }))
  const mists = [0.9, 2.9, 5.0].map((a, i) => ({
    x: Math.cos(a) * (7.5 + hash01(i, 311)),
    z: Math.sin(a) * (7.5 + hash01(i, 312)),
    ph: hash01(i, 313) * Math.PI * 2,
  }))

  return {
    textures: [floorTex, fernTex, broadleafTex, crownTex, vineTex, canopyTex, mistTex],
    materials: [
      floorMat, plinthMat, rockMat, fernMat, broadleafMat, crownMat, vineMat,
      canopyMat, trunkMat, farTrunkMat, shaftMat, mistMat, wingMatA, wingMatB, bodyMat,
    ],
    geometries: [planeGeo, fernGeo, leafGeo, crownGeo, vineGeo, trunkGeo, rockGeo, shaftGeo, mistGeo, wingGeo],
    floorMat, plinthMat, rockMat, fernMat, broadleafMat, crownMat, vineMat,
    canopyMat, trunkMat, farTrunkMat, shaftMat, mistMat, wingMatA, wingMatB, bodyMat,
    planeGeo, fernGeo, leafGeo, crownGeo, vineGeo, trunkGeo, rockGeo, shaftGeo, mistGeo, wingGeo,
    ferns: ringMatrices({ seed: 401, count: 26, rMin: 10.3, rMax: 12.6, yMin: GROUND_Y - 0.05, yMax: GROUND_Y, sMin: 1.7, sMax: 2.9, faceCenter: true, cross: true }),
    broadleaves: ringMatrices({ seed: 402, count: 20, rMin: 10.6, rMax: 13.4, yMin: GROUND_Y - 0.05, yMax: GROUND_Y, sMin: 1.9, sMax: 3.3, faceCenter: true }),
    palms: palmMatrices(403, 14, 13, 18),
    vines: ringMatrices({ seed: 404, count: 12, rMin: 11, rMax: 16, yMin: 8.2, yMax: 9.4, sMin: 0.75, sMax: 1.25, faceCenter: true }),
    farTrunks: ringMatrices({ seed: 405, count: 30, rMin: 17, rMax: 30, yMin: GROUND_Y, yMax: GROUND_Y, sMin: 0.35, sMax: 0.75, hMin: 9, hMax: 15 }),
    canopy: ringMatrices({ seed: 406, count: 34, rMin: 4.5, rMax: 21, yMin: 9.5, yMax: 12.5, sMin: 5, sMax: 8.5, lieFlat: true }),
    rocks: ringMatrices({ seed: 407, count: 7, rMin: 8.4, rMax: 10.4, yMin: GROUND_Y - 0.25, yMax: GROUND_Y - 0.1, sMin: 0.35, sMax: 0.85, hMin: 0.25, hMax: 0.5 }),
    shaftQuat,
    heroes,
    mists,
  }
}

const SHAFT_XZ: readonly (readonly [number, number])[] = [
  [1.2, 0.4], [-3.2, 2.2], [3.8, -2.8], [-1.5, -4.2], [2.6, 3.4],
]

export default function AscendJungle({ reduced }: { reduced: boolean }) {
  const a = useMemo(buildJungle, [])
  useEffect(() => () => {
    for (const t of a.textures) t.dispose()
    for (const m of a.materials) m.dispose()
    for (const g of a.geometries) g.dispose()
  }, [a])

  const heroRefs = useRef<(Mesh | null)[]>([])
  const mistRefs = useRef<(Mesh | null)[]>([])

  // All ambient motion — frozen entirely under reduced motion.
  useFrame(({ clock }) => {
    if (reduced) return
    const t = clock.elapsedTime
    a.shaftMat.opacity = 0.055 + 0.025 * (0.5 + 0.5 * Math.sin(t * 0.5))
    a.heroes.forEach((h, i) => {
      const m = heroRefs.current[i]
      if (m) m.rotation.z = Math.sin(t * 0.45 + h.ph) * 0.055
    })
    a.mists.forEach((ms, i) => {
      const m = mistRefs.current[i]
      if (!m) return
      m.rotation.z = ms.ph + t * 0.02
      m.position.x = ms.x + Math.sin(t * 0.05 + ms.ph) * 0.7
    })
  })

  return (
    <group>
      {/* forest floor + the mossy stone plinth the board rests on */}
      <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}
        geometry={a.planeGeo} material={a.floorMat} receiveShadow />
      <mesh position={[0, -0.29, 0]} material={a.plinthMat} receiveShadow>
        <boxGeometry args={[14.6, 0.222, 14.6]} />
      </mesh>

      {/* layered foliage rings — near ferns/broadleaves, mid palms + vines,
          far trunks melting into the fog, canopy pads overhead */}
      <Instanced geo={a.fernGeo} mat={a.fernMat} matrices={a.ferns} />
      <Instanced geo={a.leafGeo} mat={a.broadleafMat} matrices={a.broadleaves} />
      <Instanced geo={a.trunkGeo} mat={a.trunkMat} matrices={a.palms.trunks} />
      <Instanced geo={a.crownGeo} mat={a.crownMat} matrices={a.palms.crowns} />
      <Instanced geo={a.vineGeo} mat={a.vineMat} matrices={a.vines} />
      <Instanced geo={a.trunkGeo} mat={a.farTrunkMat} matrices={a.farTrunks} />
      <Instanced geo={a.leafGeo} mat={a.canopyMat} matrices={a.canopy} />
      <Instanced geo={a.rockGeo} mat={a.rockMat} matrices={a.rocks} />

      {/* hero broadleaves at the clearing edge — the ones that visibly sway */}
      {a.heroes.map((h, i) => (
        <mesh key={i} ref={(m) => { heroRefs.current[i] = m }}
          position={[h.x, GROUND_Y - 0.02, h.z]} rotation={[0, h.yaw, 0]}
          scale={h.s} geometry={a.leafGeo} material={a.broadleafMat} />
      ))}

      {/* god rays — additive shafts aligned with the key light */}
      {SHAFT_XZ.map(([x, z], i) => (
        <mesh key={i} position={[x, 5.1, z]} quaternion={a.shaftQuat}
          geometry={a.shaftGeo} material={a.shaftMat} />
      ))}

      {/* drifting ground mist at the clearing edge */}
      {a.mists.map((m, i) => (
        <mesh key={i} ref={(mm) => { mistRefs.current[i] = mm }}
          position={[m.x, 0.32, m.z]} rotation={[-Math.PI / 2, 0, m.ph]}
          geometry={a.mistGeo} material={a.mistMat} />
      ))}

      {/* life: fireflies low, pollen in the light shafts, butterflies over the board */}
      <Sparkles count={42} scale={[24, 3, 24]} position={[0, 1.4, 0]} size={4}
        color="#ffd98a" opacity={0.85} speed={reduced ? 0 : 0.35} noise={reduced ? 0 : 1} />
      <Sparkles count={70} scale={[15, 7, 15]} position={[0, 4.5, 0]} size={1.6}
        color="#fff2c4" opacity={0.5} speed={reduced ? 0 : 0.12} noise={reduced ? 0 : 0.6} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Butterfly key={i} i={i} reduced={reduced} wingGeo={a.wingGeo}
          wingMat={i % 2 === 0 ? a.wingMatA : a.wingMatB} bodyMat={a.bodyMat} />
      ))}
    </group>
  )
}
