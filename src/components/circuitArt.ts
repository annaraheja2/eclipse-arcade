// The road surface, authored as ONE cross-section tile that repeats down the
// camera plane. Because the plane is tilted in 3D, this flat top-down artwork
// becomes the perspective road for free — there are no parallax layers to keep
// in sync any more, just this single scrolling texture.
//
// The tile is SEAMLESS on y: nothing crosses y=0 or y=TILE, and every repeating
// element divides TILE exactly (kerb blocks 10×50, centre dashes 5×100).
//
// Widths are authored across a 1000-unit cross-section and stretched to the
// plane with `preserveAspectRatio="none"`, so the layout is proportional:
//
//   grass │ gravel │ runoff │ kerb │ TRACK │ kerb │ runoff │ gravel │ grass

/** Cross-section geometry, in tile units. The single source of truth for width. */
const X = {
  gravelL: 170,
  runoffL: 250,
  kerbL: 300,
  trackL: 330,
  trackR: 670,
  kerbR: 700,
  runoffR: 750,
  gravelR: 830,
  full: 1000,
} as const

/** Tile height in cross-section units — the vertical repeat length. */
const TILE = 500

/**
 * Share of the plane's width taken by racing surface, kerb to kerb. The
 * component multiplies a car's lateral fraction by this, so cars sit on tarmac
 * rather than in the gravel no matter how wide the plane is drawn.
 */
export const TRACK_WIDTH_FRACTION = (X.kerbR - X.kerbL) / X.full

/** Tile repeat height as a fraction of the plane's depth. */
export const SURFACE_TILE_FRACTION = 0.115

// Desaturated, overcast-daylight tarmac — realism, not poster colour.
const C = {
  grass: '#33422c',
  grassLit: '#3d4f34',
  gravel: '#79705d',
  gravelLit: '#8a806b',
  runoff: '#4a4d53',
  kerbRed: '#a8231b',
  kerbWhite: '#d5d6d2',
  asphalt: '#34373d',
  asphaltWorn: '#3b3e45',
  rubber: '#2a2c31',
  line: '#d9dce0',
  seam: '#292b30',
} as const

const svg = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${X.full} ${TILE}" preserveAspectRatio="none">${body}</svg>`
  )}")`

const band = (x: number, w: number, fill: string, opacity = 1) =>
  `<rect x="${x}" y="0" width="${w}" height="${TILE}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`

/** Red/white kerb blocks, alternating down the tile. 10 blocks × 50 = TILE. */
function kerb(x: number, w: number): string {
  const out: string[] = []
  for (let i = 0; i < TILE / 50; i++) {
    out.push(`<rect x="${x}" y="${i * 50}" width="${w}" height="50" fill="${i % 2 ? C.kerbWhite : C.kerbRed}"/>`)
  }
  // Kerbs are ramped concrete, not paint — a lit inner edge sells the relief.
  return `${out.join('')}<rect x="${x}" y="0" width="${w * 0.22}" height="${TILE}" fill="#ffffff" opacity="0.14"/>`
}

/** Dashed centre line: 5 dashes × 100 = TILE. */
function centreDashes(): string {
  const out: string[] = []
  const cx = (X.trackL + X.trackR) / 2
  for (let i = 0; i < TILE / 100; i++) {
    out.push(`<rect x="${cx - 5}" y="${i * 100}" width="10" height="46" fill="${C.line}" opacity="0.5"/>`)
  }
  return out.join('')
}

/** Scattered gravel stones so the trap doesn't read as flat paint. */
function stones(): string {
  const out: string[] = []
  // Deterministic scatter — a fixed table, so the tile is stable across builds.
  const pts = [
    [186, 62], [214, 148], [196, 240], [230, 331], [178, 402], [222, 466],
    [206, 108], [192, 300], [236, 200], [180, 358],
    [766, 40], [800, 130], [778, 226], [812, 318], [790, 396], [758, 470],
    [820, 84], [772, 172], [806, 262], [784, 434],
  ] as const
  for (const [x, y] of pts) {
    out.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="${C.gravelLit}" opacity="0.75"/>`)
    out.push(`<circle cx="${x + 2}" cy="${y + 2}" r="3.2" fill="#000000" opacity="0.2"/>`)
  }
  return out.join('')
}

const GRAIN =
  `<filter id="grain" x="0" y="0" width="100%" height="100%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
  `<feColorMatrix type="saturate" values="0"/></filter>`

export const SURFACE = svg(
  `<defs>${GRAIN}</defs>` +
    // --- verges, symmetric outward from the track ---
    band(0, X.gravelL, C.grass) +
    band(X.gravelL, X.runoffL - X.gravelL, C.gravel) +
    band(X.runoffL, X.kerbL - X.runoffL, C.runoff) +
    band(X.kerbR, X.runoffR - X.kerbR, C.runoff) +
    band(X.runoffR, X.gravelR - X.runoffR, C.gravel) +
    band(X.gravelR, X.full - X.gravelR, C.grass) +
    // mown stripes on the grass — cheap, and instantly reads as a real circuit
    band(40, 46, C.grassLit, 0.5) +
    band(900, 46, C.grassLit, 0.5) +
    stones() +
    // --- racing surface ---
    band(X.trackL, X.trackR - X.trackL, C.asphalt) +
    // rubbered-in racing line: two tyre tracks, darkest where the cars actually run
    band(X.trackL + 70, 86, C.rubber, 0.55) +
    band(X.trackR - 156, 86, C.rubber, 0.55) +
    band(X.trackL + 30, X.trackR - X.trackL - 60, C.asphaltWorn, 0.25) +
    // --- kerbs and edge lines ---
    kerb(X.kerbL, X.trackL - X.kerbL) +
    kerb(X.trackR, X.kerbR - X.trackR) +
    band(X.trackL, 9, C.line, 0.8) +
    band(X.trackR - 9, 9, C.line, 0.8) +
    centreDashes() +
    // --- surface detail: one expansion joint per tile, then grain over everything ---
    `<rect x="${X.trackL}" y="${TILE - 6}" width="${X.trackR - X.trackL}" height="4" fill="${C.seam}" opacity="0.6"/>` +
    `<rect x="0" y="0" width="${X.full}" height="${TILE}" filter="url(#grain)" opacity="0.09"/>`
)
