// Hand-authored cartoon-circuit scenery, one SVG tile per parallax layer.
//
// Every tile is built as a data-URI background that repeats on x, so an infinite
// scroll is just a wrapped translate (see `layerOffset` in lib/circuit.ts) — no
// DOM churn, no re-layout. Tiles are authored SEAMLESS: nothing crosses x=0 or
// x=tile, and any full-width band (armco, kerb, verge) spans edge to edge.
//
// Each viewBox is drawn at roughly the aspect its band occupies so that
// `preserveAspectRatio="none"` stretching stays invisible.

const C = {
  hillFar: '#a3d3ee',
  hillNear: '#6fb877',
  stand: '#2b3346',
  standLip: '#f4f6fa',
  roof: '#e4322b',
  trunk: '#6b4a2f',
  leafDark: '#2f7a3c',
  leaf: '#49a94b',
  armco: '#dfe6ef',
  post: '#8d97a8',
  tyre: '#191d25',
  board: '#1e2430',
  kerbRed: '#e4322b',
  kerbWhite: '#f4f6fa',
  asphalt: '#3c4250',
  asphaltLit: '#464d5e',
  line: '#eef2f8',
  grass: '#49a94b',
  grassDeep: '#34803f',
} as const

const svg = (viewBox: string, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none">${body}</svg>`
  )}")`

// ---- clouds (0.04x) -------------------------------------------------------
const cloud = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="#ffffff" opacity="0.9">` +
  `<ellipse cx="0" cy="0" rx="46" ry="15"/><ellipse cx="-18" cy="-8" rx="26" ry="14"/>` +
  `<ellipse cx="18" cy="-9" rx="21" ry="12"/></g>`

const CLOUDS = svg('0 0 620 76', cloud(84, 50, 1) + cloud(300, 32, 0.72) + cloud(478, 56, 1.15))

// ---- rolling hills (0.08x) ------------------------------------------------
// Both silhouettes start and end at the same y so the seam is invisible.
const HILLS = svg(
  '0 0 700 90',
  `<path d="M0 90 L0 40 Q70 10 150 36 Q230 62 310 32 Q390 6 480 36 Q570 66 640 34 Q672 20 700 40 L700 90Z" fill="${C.hillFar}"/>` +
    `<path d="M0 90 L0 62 Q90 40 170 60 Q250 80 330 56 Q410 34 500 60 Q600 86 700 62 L700 90Z" fill="${C.hillNear}"/>`
)

// ---- trackside: grandstand, trees, flags (0.25x) --------------------------
function crowd(): string {
  const shirts = ['#d8dee9', '#8fa6c4', '#e9eef5', '#b9c6d8', '#ffd76a', '#a7b6cc', '#e4926a']
  const dots: string[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 28; col++) {
      const x = 30 + col * 6.2 + (row % 2 ? 3 : 0)
      dots.push(`<rect x="${x.toFixed(1)}" y="${52 + row * 7}" width="4" height="5" rx="2" fill="${shirts[(row * 5 + col) % shirts.length]}"/>`)
    }
  }
  return dots.join('')
}

const tree = (x: number, s: number) =>
  `<g transform="translate(${x} 128) scale(${s})">` +
  `<rect x="-4" y="-26" width="8" height="26" rx="3" fill="${C.trunk}"/>` +
  `<circle cx="0" cy="-40" r="20" fill="${C.leafDark}"/><circle cx="-13" cy="-30" r="14" fill="${C.leaf}"/>` +
  `<circle cx="13" cy="-31" r="13" fill="${C.leaf}"/><circle cx="2" cy="-48" r="12" fill="${C.leaf}"/></g>`

function chequeredFlag(x: number): string {
  const squares: string[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      squares.push(`<rect x="${x + 4 + c * 7}" y="${44 + r * 7}" width="7" height="7" fill="${(r + c) % 2 ? '#12151c' : '#f4f6fa'}"/>`)
    }
  }
  return `<rect x="${x}" y="40" width="4" height="88" rx="2" fill="${C.post}"/>${squares.join('')}`
}

const TRACKSIDE = svg(
  '0 0 460 128',
  // grandstand — crowd rows sit high enough to clear the barrier layer in front
  `<rect x="24" y="44" width="180" height="84" fill="${C.stand}"/>` +
    `<path d="M14 44 L214 44 L204 24 L24 24 Z" fill="${C.roof}"/>` +
    `<rect x="14" y="40" width="200" height="7" rx="2" fill="${C.standLip}"/>` +
    crowd() +
    // pit / marshal tower
    `<rect x="360" y="34" width="86" height="94" fill="${C.stand}"/>` +
    `<rect x="352" y="28" width="102" height="10" rx="3" fill="${C.standLip}"/>` +
    `<rect x="372" y="48" width="26" height="20" rx="3" fill="${C.hillFar}"/>` +
    `<rect x="408" y="48" width="26" height="20" rx="3" fill="${C.hillFar}"/>` +
    `<rect x="372" y="78" width="62" height="8" rx="3" fill="${C.roof}"/>` +
    tree(240, 1) +
    tree(292, 0.78) +
    chequeredFlag(324)
)

// ---- barriers, boards, tyre stacks (0.6x) --------------------------------
function tyreStack(x: number): string {
  const rows: string[] = []
  for (let i = 0; i < 3; i++) rows.push(`<rect x="${x}" y="${37 - i * 7}" width="24" height="7" rx="3.5" fill="${C.tyre}"/>`)
  return rows.join('')
}

const BARRIER = svg(
  '0 0 300 64',
  // advertising hoardings — four panels that exactly partition the tile. Light
  // faces so they read as boards IN FRONT of the dark stands behind them.
  `<rect x="0" y="14" width="75" height="17" fill="#eef2f8"/><rect x="75" y="14" width="75" height="17" fill="#2c4f8f"/>` +
    `<rect x="150" y="14" width="75" height="17" fill="#eef2f8"/><rect x="225" y="14" width="75" height="17" fill="#1c6b62"/>` +
    `<rect x="10" y="20" width="55" height="6" rx="3" fill="${C.kerbRed}" opacity="0.8"/>` +
    `<rect x="160" y="20" width="55" height="6" rx="3" fill="#2c4f8f" opacity="0.8"/>` +
    `<rect x="86" y="20" width="53" height="6" rx="3" fill="#ffffff" opacity="0.65"/>` +
    `<rect x="236" y="20" width="53" height="6" rx="3" fill="#ffffff" opacity="0.65"/>` +
    // armco rail
    `<rect x="0" y="32" width="300" height="9" rx="3" fill="${C.armco}"/>` +
    `<rect x="0" y="35" width="300" height="3" fill="${C.post}" opacity="0.55"/>` +
    `<rect x="24" y="39" width="7" height="11" fill="${C.post}"/><rect x="124" y="39" width="7" height="11" fill="${C.post}"/>` +
    `<rect x="224" y="39" width="7" height="11" fill="${C.post}"/>` +
    tyreStack(56) +
    tyreStack(196) +
    // grass run-off below the barrier
    `<rect x="0" y="46" width="300" height="18" fill="${C.grass}"/>`
)

// ---- the road itself (1.0x) ----------------------------------------------
function kerbBlocks(y: number, h: number, w: number): string {
  const blocks: string[] = []
  for (let x = 0; x < 168; x += w) {
    blocks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${(x / w) % 2 ? C.kerbWhite : C.kerbRed}"/>`)
  }
  return blocks.join('')
}

const ROAD = svg(
  '0 0 168 140',
  `<rect x="0" y="0" width="168" height="140" fill="${C.asphalt}"/>` +
    kerbBlocks(0, 6, 21) +
    `<rect x="0" y="6" width="168" height="3" fill="${C.line}" opacity="0.85"/>` +
    `<rect x="0" y="9" width="168" height="5" fill="#000000" opacity="0.2"/>` +
    `<rect x="0" y="28" width="168" height="40" fill="${C.asphaltLit}" opacity="0.45"/>` +
    `<rect x="16" y="70" width="80" height="6" rx="3" fill="${C.line}" opacity="0.9"/>` +
    // near edge: a plain white line and a dark shoulder — the red/white kerb is
    // kept to the far side alone so the road doesn't read as a striped lane.
    `<rect x="0" y="103" width="168" height="4" fill="${C.line}" opacity="0.8"/>` +
    `<rect x="0" y="107" width="168" height="5" fill="#000000" opacity="0.25"/>` +
    `<rect x="0" y="112" width="168" height="28" fill="${C.grassDeep}"/>`
)

// ---- foreground verge (1.6x) ---------------------------------------------
function blades(): string {
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    const x = i * 8
    out.push(`<path d="M${x} 26 L${x + 4} ${i % 2 ? 2 : 8} L${x + 8} 26 Z" fill="${i % 3 ? C.grass : C.leafDark}"/>`)
  }
  return out.join('')
}

const VERGE = svg('0 0 96 26', `<rect x="0" y="8" width="96" height="18" fill="${C.grassDeep}"/>${blades()}`)

// ---- layer stack ----------------------------------------------------------
// `top`/`height` are percentages of the panel; `factor` is the fraction of road
// speed the layer scrolls at; `tile` is the repeat width in px.
export interface CircuitLayer {
  readonly key: string
  readonly image: string
  readonly factor: number
  readonly tile: number
  readonly top: number
  readonly height: number
  /** Depth-of-field blur, px — only the foreground verge, which whips past. */
  readonly blur?: number
}

export const LAYERS: readonly CircuitLayer[] = [
  { key: 'clouds', image: CLOUDS, factor: 0.04, tile: 620, top: 3, height: 22 },
  { key: 'hills', image: HILLS, factor: 0.08, tile: 700, top: 25, height: 32 },
  { key: 'trackside', image: TRACKSIDE, factor: 0.25, tile: 460, top: 14, height: 42 },
  { key: 'barrier', image: BARRIER, factor: 0.6, tile: 300, top: 43, height: 15 },
  { key: 'road', image: ROAD, factor: 1, tile: 168, top: 55, height: 45 },
  { key: 'verge', image: VERGE, factor: 1.6, tile: 96, top: 92, height: 8, blur: 1.4 },
]
