import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties } from 'react'
import type { Car } from '../lib/racer'
import {
  carPlacement, laneFor, pxPerUnit, surfaceOffset, speedFeel, tyreBlurPx, carWidthPx,
  projectionScale, plateScale, plateSide, plateDropPx,
  CAR_LENGTH_M, CAR_WIDTH_M, CAMERA_TILT_DEG, CAMERA_PERSPECTIVE_PX,
} from '../lib/circuit'
import { SURFACE, SURFACE_TILE_FRACTION, TRACK_WIDTH_FRACTION } from './circuitArt'

/**
 * The angled-overhead circuit: a chase camera looking DOWN at the track from
 * behind and above. The road is ONE plane tilted in 3D (`--tilt`, owned by the
 * stylesheet), so perspective is the compositor's job — this file never
 * computes a scale or a horizon. Cars lie flat on that plane as top-down
 * sprites and are foreshortened by the same tilt, which is exactly the
 * projection a real helicopter shot gives.
 *
 * Nothing here re-renders during a race. The page's rAF loop calls `render()`
 * once a frame and this component writes `translate3d` straight onto the
 * surface and car nodes — no React state, no layout reads (plane size comes
 * from a ResizeObserver). HUD numbers are the page's job, throttled below 60fps.
 */
export interface CircuitHandle {
  /** Paint one frame from the authoritative sim state. */
  render(cars: readonly Car[], youId: string): void
  /** Roll the world to a stop after the flag — purely visual, never the sim. */
  coastToStop(speedMph: number): void
  /** One-shot camera kick on an answer: a surge forward or a braking dip. */
  pulse(dir: 'up' | 'down'): void
}

interface Props {
  /** The field, in a fixed order — identities only; positions arrive via render(). */
  field: readonly Car[]
  youId: string
  /** Freezes the scrolling road and all decorative FX; cars still reposition. */
  reduced: boolean
  /** Chequered-flag flourish while the results screen is on its way. */
  flagged: boolean
}

/** Custom properties this component sets, declared rather than asserted. */
type StageVars = CSSProperties & { '--tilt': string }
type CarVars = CSSProperties & { '--body': string }

const COAST_SECONDS = 1.4
/** Streak scroll relative to the road (>1: the near-field rushes past faster). */
const RUSH_RATE = 1.6
/** Period of .rc-speed's dash mask (6px dash + 16px gap) — the wrap length. */
const RUSH_TILE_PX = 22
/** Screen px between a car's projected nose (or tail) and its name plate. */
const PLATE_GAP_PX = 6
/** The plate's authored screen height (10px text + padding + border), with slack. */
const PLATE_HEIGHT_PX = 22
const TILT_COS = Math.cos((CAMERA_TILT_DEG * Math.PI) / 180)

/** The camera angle, declared once from lib/circuit.ts's constants (see there). */
const STAGE_VARS: StageVars = {
  '--tilt': `${CAMERA_TILT_DEG}deg`,
  perspective: `${CAMERA_PERSPECTIVE_PX}px`,
}

/**
 * Memoised: the page re-renders its HUD ~8 times a second and the circuit must
 * not follow it. Every prop here is stable for the whole race except `flagged`.
 */
const Circuit = memo(forwardRef<CircuitHandle, Props>(function Circuit({ field, youId, reduced, flagged }, ref) {
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const shakeRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)
  const carRefs = useRef(new Map<string, HTMLDivElement>())

  // Plane size in PLANE-LOCAL px (the untransformed layout box), from the
  // observer — never a per-frame getBoundingClientRect. `tile` and `carL` are
  // derived once here so every consumer shares the same rounded values.
  const planeRef = useRef({ w: 0, d: 0, tile: 0, carL: 0 })
  const distanceRef = useRef(0)
  const pinRef = useRef(new Map<string, string>())
  const sideRef = useRef(new Map<string, string>())
  const blurRef = useRef(new Map<string, number>())
  const zRef = useRef(new Map<string, number>())
  const plateRef = useRef(new Map<string, string>())
  const coastRaf = useRef(0)

  // Lane per car id, rebuilt only when the field is — no ref writes during render.
  const lanes = useMemo(() => new Map(field.map((car, i) => [car.id, laneFor(i)])), [field])

  useEffect(() => {
    const world = worldRef.current
    const stage = stageRef.current
    if (!world || !stage) return
    const measure = (w: number, d: number) => {
      const carW = carWidthPx(w * TRACK_WIDTH_FRACTION)
      const carL = carW * (CAR_LENGTH_M / CAR_WIDTH_M)
      // One rounded tile shared by the repeat layout AND the scroll wrap, so
      // the two periods can never drift and nudge the tiling at each wrap.
      const tile = Math.round(d * SURFACE_TILE_FRACTION * 10) / 10
      planeRef.current = { w, d, tile, carL }
      stage.style.setProperty('--tile', `${tile}px`)
      stage.style.setProperty('--car-w', `${carW.toFixed(1)}px`)
      stage.style.setProperty('--car-l', `${carL.toFixed(1)}px`)
    }
    measure(world.offsetWidth, world.offsetHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure(world.offsetWidth, world.offsetHeight))
    ro.observe(world)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => cancelAnimationFrame(coastRaf.current), [])

  function paintSurface(): void {
    if (reduced) return
    const el = surfaceRef.current
    if (el) el.style.transform = `translate3d(0,${surfaceOffset(distanceRef.current, planeRef.current.tile).toFixed(1)}px,0)`
  }

  // The edge streaks ARE the speedometer you feel: they scroll with the world
  // (faster than the road) and fade with speed, so they decelerate through the
  // coast-to-stop as well as during the race. `feel` is speedFeel(mph).
  function paintStreaks(feel: number): void {
    if (reduced) return
    const el = speedRef.current
    if (!el) return
    el.style.opacity = (feel * 0.55).toFixed(3)
    el.style.transform =
      `translate3d(0,${surfaceOffset(distanceRef.current * RUSH_RATE, RUSH_TILE_PX).toFixed(1)}px,0)`
  }

  useImperativeHandle(ref, () => ({
    render(cars, id) {
      const { w, d, carL } = planeRef.current
      if (d <= 0) return
      const you = cars.find((c) => c.id === id)
      if (!you) return

      distanceRef.current = you.distance * pxPerUnit(d)
      paintSurface()

      if (!reduced) {
        // Perceptual curve: mid-range speed changes must READ, not just the cap.
        const feel = speedFeel(you.speed)
        paintStreaks(feel)
        // Shake is phased off distance, not time, so a stopped car sits dead still.
        if (shakeRef.current) {
          shakeRef.current.style.transform =
            `translate3d(0,${(Math.sin(distanceRef.current * 0.09) * feel * feel * 2.1).toFixed(2)}px,0)`
        }
      }

      const trackW = w * TRACK_WIDTH_FRACTION
      for (const car of cars) {
        const el = carRefs.current.get(car.id)
        if (!el) continue
        const placement = carPlacement(car.distance - you.distance)
        const x = (lanes.get(car.id) ?? 0) * trackW
        el.style.transform = `translate3d(${x.toFixed(1)}px,${(placement.depth * d).toFixed(1)}px,0)`

        // Nearer cars occlude farther ones — depth is the whole stacking story.
        const z = 10 + Math.round(placement.depth * 100)
        if (zRef.current.get(car.id) !== z) { zRef.current.set(car.id, z); el.style.zIndex = String(z) }

        const pin = placement.kind === 'pinned' ? placement.side : 'none'
        if (pinRef.current.get(car.id) !== pin) { pinRef.current.set(car.id, pin); el.dataset.pin = pin }

        // Near the horizon an above-the-car plate would clip off the stage top,
        // so it flips below the car there — see plateSide() and .rc-plate.
        const side = plateSide(placement.depth)
        if (sideRef.current.get(car.id) !== side) { sideRef.current.set(car.id, side); el.dataset.plate = side }

        // Tyre blur is decorative FX — frozen at 0 under reduced motion.
        const blur = reduced ? 0 : Math.round(tyreBlurPx(car.speed) * 10) / 10
        if (blurRef.current.get(car.id) !== blur) {
          blurRef.current.set(car.id, blur)
          el.style.setProperty('--tyre-blur', `${blur}px`)
        }

        // The plate cancels the perspective divide to hold a legible screen
        // size — see .rc-plate. Above the car it lifts clear of the projected
        // nose; below (near the horizon) it stands on the plane at a dropped
        // ground point, scaled for ITS depth, clear of the projected tail.
        const drop = side === 'below' ? plateDropPx(placement.depth, d, carL, PLATE_HEIGHT_PX, PLATE_GAP_PX) : 0
        const proj = projectionScale(placement.depth, d)
        const scale = plateScale(placement.depth + drop / d, d).toFixed(2)
        const lift = side === 'below'
          ? drop.toFixed(1)
          : ((carL / 2) * TILT_COS * proj + PLATE_GAP_PX).toFixed(1)
        const plate = `${side}|${scale}|${lift}`
        if (plateRef.current.get(car.id) !== plate) {
          plateRef.current.set(car.id, plate)
          el.style.setProperty('--plate-scale', scale)
          el.style.setProperty(side === 'below' ? '--plate-drop' : '--plate-lift', `${lift}px`)
        }
      }
    },
    pulse(dir) {
      if (reduced) return
      const stage = stageRef.current
      if (!stage) return
      // Clear + reflow so back-to-back answers each restart the keyframes.
      delete stage.dataset.kick
      void stage.offsetWidth
      stage.dataset.kick = dir
    },
    coastToStop(speedMph) {
      if (reduced || speedMph <= 0) return
      cancelAnimationFrame(coastRaf.current)
      let v = speedMph
      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05)
        last = now
        v = Math.max(0, v - (speedMph / COAST_SECONDS) * dt)
        distanceRef.current += v * dt * pxPerUnit(planeRef.current.d)
        paintSurface()
        paintStreaks(speedFeel(v)) // streaks decelerate and fade with the road
        if (v > 0.01) coastRaf.current = requestAnimationFrame(tick)
      }
      coastRaf.current = requestAnimationFrame(tick)
    },
  }))

  return (
    <div ref={stageRef} className="rc-stage" style={STAGE_VARS}>
      <div aria-hidden className="rc-sky" />
      <div ref={shakeRef} className="rc-shake">
        <div ref={worldRef} className="rc-world">
          <div ref={surfaceRef} aria-hidden className="rc-surface" style={{ backgroundImage: SURFACE }} />
          {/* aerial perspective: fog lying ON the plane, under the cars — see .rc-haze */}
          <div aria-hidden className="rc-haze" />
          {field.map((car) => {
            const carVars: CarVars = { '--body': car.color }
            return (
              <div key={car.id} className={`rc-car${car.id === youId ? ' is-you' : ''}`} data-pin="none" data-plate="above"
                ref={(el) => {
                  if (el) { carRefs.current.set(car.id, el); return }
                  carRefs.current.delete(car.id)
                  pinRef.current.delete(car.id)
                  sideRef.current.delete(car.id)
                  blurRef.current.delete(car.id)
                  zRef.current.delete(car.id)
                  plateRef.current.delete(car.id)
                }}
                style={carVars}>
                <span aria-hidden className="rc-shadow" />
                <span className="rc-body"><TopDownCar isPlayer={car.id === youId} /></span>
                <span className="rc-plate font-race font-bold text-[10px] tracking-wide">
                  <span aria-hidden className="rc-chev rc-chev-behind"><Chevron dir="down" /></span>
                  {car.name}
                  <span aria-hidden className="rc-chev rc-chev-ahead"><Chevron dir="up" /></span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div ref={speedRef} aria-hidden className="rc-speed" style={{ opacity: 0 }} />
      {flagged && <div aria-hidden className="rc-flag" />}
      <div aria-hidden className="rc-vignette" />
    </div>
  )
}))

export default Circuit

function Chevron({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'up' ? 'M5 15 L12 8 L19 15' : 'M5 9 L12 16 L19 9'} />
    </svg>
  )
}

/**
 * A modern single-seater seen from directly overhead, nose up — the plane's
 * tilt supplies the viewing angle, so this is drawn at true plan proportions
 * (5.6m × 2.0m, matching CAR_LENGTH_M / CAR_WIDTH_M).
 *
 * Flat fills only — no gradients, and no per-shape filters. The only blurs on
 * a car are the soft drop shadow (`.rc-shadow`) and the tyre group
 * (`.rc-tyres`): one fixed filter region each, cheap enough for four cars a
 * frame. Sunlight is treated as coming from the left, so highlights sit left
 * and contact shadows sit right. Livery arrives via the `--body` custom
 * property, so one sprite serves the whole field.
 */
function TopDownCar({ isPlayer }: { isPlayer: boolean }) {
  const carbon = '#1b1d21'
  const carbonLit = '#292c32'
  return (
    <svg className="rc-sprite" viewBox="0 0 100 280" aria-hidden preserveAspectRatio="none">
      {/* ---- front wing ---- */}
      <rect x="8" y="6" width="84" height="9" rx="2" fill={carbon} />
      <rect x="8" y="13" width="84" height="7" rx="2" fill="var(--body)" />
      <rect x="8" y="19" width="84" height="5" rx="2" fill={carbonLit} />
      {/* endplates */}
      <rect x="4" y="4" width="7" height="30" rx="2" fill={carbon} />
      <rect x="89" y="4" width="7" height="30" rx="2" fill={carbon} />

      {/* ---- nose cone ---- */}
      <path d="M44 16 L56 16 L61 96 L39 96 Z" fill="var(--body)" />
      <path d="M44 16 L50 16 L50 96 L39 96 Z" fill="#ffffff" opacity="0.1" />

      {/* ---- front suspension ---- */}
      <rect x="16" y="72" width="30" height="3.5" rx="1.75" fill={carbonLit} />
      <rect x="54" y="72" width="30" height="3.5" rx="1.75" fill={carbonLit} />
      <rect x="16" y="94" width="30" height="3.5" rx="1.75" fill={carbonLit} />
      <rect x="54" y="94" width="30" height="3.5" rx="1.75" fill={carbonLit} />

      {/* ---- floor / sidepods ---- */}
      <path d="M34 112 L66 112 L74 200 L26 200 Z" fill={carbon} />
      <path d="M36 120 Q22 132 20 160 L24 196 L40 196 L40 124 Z" fill="var(--body)" />
      <path d="M64 120 Q78 132 80 160 L76 196 L60 196 L60 124 Z" fill="var(--body)" />
      {/* sidepod inlets */}
      <rect x="21" y="126" width="15" height="12" rx="4" fill="#0d0f12" />
      <rect x="64" y="126" width="15" height="12" rx="4" fill="#0d0f12" />
      {/* sun side highlight */}
      <path d="M36 120 Q22 132 20 160 L24 196 L29 196 L27 160 Q29 134 40 124 Z" fill="#ffffff" opacity="0.12" />

      {/* ---- cockpit + halo ---- */}
      <path d="M38 100 L62 100 L64 148 L36 148 Z" fill={carbonLit} />
      <ellipse cx="50" cy="126" rx="10" ry="15" fill="#0b0d10" />
      {/* helmet */}
      <ellipse cx="50" cy="126" rx="7" ry="9" fill="var(--body)" />
      <ellipse cx="50" cy="123" rx="7" ry="4" fill="#e8ecf2" opacity="0.9" />
      {/* halo ring */}
      <path d="M37 138 Q37 104 50 102 Q63 104 63 138" stroke="#15171b" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M50 102 L50 116" stroke="#15171b" strokeWidth="4" strokeLinecap="round" />

      {/* ---- engine cover ---- */}
      <path d="M42 148 L58 148 L56 236 L44 236 Z" fill="var(--body)" />
      <path d="M42 148 L48 148 L47 236 L44 236 Z" fill="#ffffff" opacity="0.1" />
      {/* airbox */}
      <path d="M44 146 L56 146 L55 158 L45 158 Z" fill="#0b0d10" />

      {/* ---- rear suspension ---- */}
      <rect x="14" y="196" width="32" height="4" rx="2" fill={carbonLit} />
      <rect x="54" y="196" width="32" height="4" rx="2" fill={carbonLit} />
      <rect x="14" y="222" width="32" height="4" rx="2" fill={carbonLit} />
      <rect x="54" y="222" width="32" height="4" rx="2" fill={carbonLit} />

      {/* ---- tyres (blurred at speed via --tyre-blur) ---- */}
      <g className="rc-tyres">
        <Tyre x={2} y={62} w={20} h={44} />
        <Tyre x={78} y={62} w={20} h={44} />
        <Tyre x={0} y={190} w={23} h={50} />
        <Tyre x={77} y={190} w={23} h={50} />
      </g>

      {/* ---- diffuser + rear wing ---- */}
      <rect x="28" y="234" width="44" height="14" rx="3" fill="#0d0f12" />
      <rect x="12" y="246" width="76" height="10" rx="2" fill="var(--body)" />
      <rect x="12" y="254" width="76" height="8" rx="2" fill={carbon} />
      <rect x="8" y="240" width="7" height="30" rx="2" fill={carbon} />
      <rect x="85" y="240" width="7" height="30" rx="2" fill={carbon} />

      {/* the player's car carries a white outline for instant readability */}
      {isPlayer && (
        <path d="M34 108 L66 108 L76 202 L74 244 L26 244 L24 202 Z"
          fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round" opacity="0.95" />
      )}
    </svg>
  )
}

function Tyre({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="#111215" />
      <rect x={x + 1.5} y={y + 2} width={w - 3} height={h - 4} rx={3} fill="#191b1f" />
      {/* sidewall catching the light, and the contact shadow opposite it */}
      <rect x={x + 1.5} y={y + 2} width={2.5} height={h - 4} rx={1.25} fill="#3a3d43" opacity="0.8" />
      <rect x={x + w - 4} y={y + 2} width={2.5} height={h - 4} rx={1.25} fill="#000000" opacity="0.5" />
    </g>
  )
}
