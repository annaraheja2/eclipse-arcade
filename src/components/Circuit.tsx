import { forwardRef, memo, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react'
import type { Car } from '../lib/racer'
import {
  layerOffset, carSlot, laneFor, staggeredX, spriteScale, pxPerUnit, speedIntensity, wheelSpinSeconds,
} from '../lib/circuit'
import { LAYERS } from './circuitArt'

/**
 * The side-view circuit: the player is pinned to a fixed screen anchor and the
 * WORLD scrolls past them in parallax layers, with rivals placed by their
 * distance RELATIVE to the player.
 *
 * Nothing here re-renders during a race. The page's rAF loop calls `render()`
 * once a frame and this component writes `translate3d` straight onto the layer
 * and car nodes — no React state, no layout reads (the track width comes from a
 * ResizeObserver). HUD numbers are the page's job, throttled well below 60fps.
 */
export interface CircuitHandle {
  /** Paint one frame from the authoritative sim state. */
  render(cars: readonly Car[], youId: string): void
  /** Roll the world to a stop after the flag — purely visual, never the sim. */
  coastToStop(speedMph: number): void
}

interface Props {
  /** The field, in a fixed order — identities only; positions arrive via render(). */
  field: readonly Car[]
  youId: string
  /** Freezes the parallax and all decorative FX; cars still reposition. */
  reduced: boolean
  /** Chequered-flag flourish while the results screen is on its way. */
  flagged: boolean
}

const COAST_SECONDS = 1.4

/**
 * Memoised: the page re-renders its HUD ~8 times a second and the circuit must
 * not follow it. Every prop here is stable for the whole race except `flagged`.
 */
const Circuit = memo(forwardRef<CircuitHandle, Props>(function Circuit({ field, youId, reduced, flagged }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const shakeRef = useRef<HTMLDivElement>(null)
  const streakRef = useRef<HTMLDivElement>(null)
  const layerRefs = useRef<(HTMLDivElement | null)[]>([])
  const carRefs = useRef(new Map<string, HTMLDivElement>())

  const widthRef = useRef(0)
  const worldRef = useRef(0)
  const spinRef = useRef(new Map<string, number>())
  const pinRef = useRef(new Map<string, string>())
  const coastRaf = useRef(0)

  // Lane stagger by car id — read by the rAF loop, rebuilt only when the field is.
  const laneXRef = useRef(new Map<string, number>())
  laneXRef.current = new Map(field.map((car, i) => [car.id, laneFor(i).x]))

  // Track width comes from a ResizeObserver, never a per-frame getBoundingClientRect.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = (width: number) => {
      widthRef.current = width
      el.style.setProperty('--car-scale', spriteScale(width).toFixed(3))
    }
    measure(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => measure(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => cancelAnimationFrame(coastRaf.current), [])

  function paintWorld(): void {
    if (reduced) return
    for (let i = 0; i < LAYERS.length; i++) {
      const el = layerRefs.current[i]
      if (el) el.style.transform = `translate3d(${layerOffset(worldRef.current, LAYERS[i].factor, LAYERS[i].tile)}px,0,0)`
    }
  }

  useImperativeHandle(ref, () => ({
    render(cars, id) {
      const w = widthRef.current
      if (w <= 0) return
      const you = cars.find((c) => c.id === id)
      if (!you) return

      worldRef.current = you.distance * pxPerUnit(w)
      paintWorld()

      if (!reduced) {
        const t = speedIntensity(you.speed)
        // Squared so the streaks only bite near the top end, where speed reads.
        if (streakRef.current) streakRef.current.style.opacity = (t * t * 0.8).toFixed(3)
        // Shake is phased off distance, not time, so a stopped car sits dead still.
        if (shakeRef.current) shakeRef.current.style.transform = `translate3d(0,${(Math.sin(worldRef.current * 0.11) * t * 1.5).toFixed(2)}px,0)`
      }

      for (const car of cars) {
        const el = carRefs.current.get(car.id)
        if (!el) continue
        const slot = carSlot(car.distance - you.distance, w)
        const x = staggeredX(slot, laneXRef.current.get(car.id) ?? 0, w)
        el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`

        const pin = slot.kind === 'pinned' ? slot.side : 'none'
        if (pinRef.current.get(car.id) !== pin) { pinRef.current.set(car.id, pin); el.dataset.pin = pin }

        const spin = Math.round(wheelSpinSeconds(car.speed) * 100) / 100
        if (spinRef.current.get(car.id) !== spin) { spinRef.current.set(car.id, spin); el.style.setProperty('--spin', `${spin}s`) }
        el.classList.toggle('is-stopped', car.speed <= 0.05)
      }
    },
    coastToStop(speedMph) {
      if (reduced || speedMph <= 0) return
      const w = widthRef.current
      let v = speedMph
      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05)
        last = now
        v = Math.max(0, v - (speedMph / COAST_SECONDS) * dt)
        worldRef.current += v * dt * pxPerUnit(w)
        paintWorld()
        if (v > 0.01) coastRaf.current = requestAnimationFrame(tick)
      }
      coastRaf.current = requestAnimationFrame(tick)
    },
  }))

  return (
    <div ref={wrapRef} className="rc-panel">
      <div aria-hidden className="rc-sky" />
      <div aria-hidden className="rc-sun" />
      <div ref={shakeRef} className="rc-shake">
        {LAYERS.map((l, i) => (
          <div key={l.key} aria-hidden className="rc-layer"
            ref={(el) => { layerRefs.current[i] = el }}
            style={{
              top: `${l.top}%`, height: `${l.height}%`,
              left: `${-l.tile}px`, right: `${-l.tile}px`,
              backgroundImage: l.image, backgroundSize: `${l.tile}px 100%`,
              filter: l.blur ? `blur(${l.blur}px)` : undefined,
            }} />
        ))}
        {field.map((car, i) => {
          const lane = laneFor(i)
          return (
            <div key={car.id} className={`rc-car${car.id === youId ? ' is-you' : ''}`} data-pin="none"
              ref={(el) => { if (el) carRefs.current.set(car.id, el); else carRefs.current.delete(car.id) }}
              style={{ top: `${lane.y * 100}%`, zIndex: 20 - i, '--body': car.color } as CSSProperties}>
              <div className="rc-car-inner" style={{ ['--lane-scale' as string]: lane.scale }}>
                <span className="rc-plate font-race font-bold text-[10px] tracking-wide">
                  <span aria-hidden className="rc-chev rc-chev-behind"><Chevron dir="left" /></span>
                  {car.name}
                  <span aria-hidden className="rc-chev rc-chev-ahead"><Chevron dir="right" /></span>
                </span>
                <RaceCar isPlayer={car.id === youId} />
              </div>
            </div>
          )
        })}
        <div ref={streakRef} aria-hidden className="rc-streaks" style={{ opacity: 0 }} />
      </div>
      {flagged && <div aria-hidden className="rc-flagsweep" />}
      <div aria-hidden className="rc-vignette" />
    </div>
  )
}))

export default Circuit

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'} />
    </svg>
  )
}

/**
 * Cartoon single-seater, drawn side-on facing right: rear wing and airbox at the
 * left, halo cockpit in the middle, long nose and a low front wing at the right.
 * Livery comes in via the `--body` custom property so one sprite serves the
 * whole field; the player's car carries a white outline for instant readability.
 */
function RaceCar({ isPlayer }: { isPlayer: boolean }) {
  return (
    <svg className="rc-sprite" width="150" height="58" viewBox="0 0 150 58" aria-hidden>
      <ellipse cx="74" cy="55" rx="66" ry="3.4" fill="#000" opacity="0.22" />

      {/* rear wing: main plane on a pylon, beam wing under it */}
      <rect x="20" y="8" width="7" height="22" fill="#10131a" />
      <rect x="2" y="2" width="40" height="8" rx="3" fill="var(--body)" />
      <rect x="8" y="13" width="28" height="4" rx="2" fill="#10131a" opacity="0.85" />
      <rect x="2" y="1" width="7" height="28" rx="3" fill="#10131a" />
      {/* floor plank */}
      <rect x="26" y="33" width="96" height="5" rx="2.5" fill="#10131a" opacity="0.75" />

      {/* tub: engine cover → cockpit → long nose */}
      <path d="M28 34 Q28 26 38 24 L54 24 Q58 16 70 16 L84 16 Q92 17 96 24 L116 27 Q130 30 141 34 L145 36 Q147 38 143 39 L130 40 L112 36 L38 36 Q28 36 28 34 Z"
        fill="var(--body)" stroke={isPlayer ? '#ffffff' : 'rgba(0,0,0,0.3)'} strokeWidth={isPlayer ? 2.2 : 1.2} strokeLinejoin="round" />
      {/* sidepod */}
      <path d="M58 26 Q74 24 88 28 L106 33 Q109 36 105 37 L62 37 Q58 35 58 31 Z" fill="#000" opacity="0.22" />
      {/* airbox */}
      <path d="M48 24 L54 7 L61 7 L63 24 Z" fill="var(--body)" stroke="rgba(0,0,0,0.28)" strokeWidth="1" strokeLinejoin="round" />
      {/* cockpit + halo */}
      <path d="M60 24 Q66 18 76 18 L88 18 L90 24 Z" fill="#10131a" />
      <path d="M61 24 Q64 12 76 11 Q89 12 92 21" stroke="#10131a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <circle cx="74" cy="19" r="5.4" fill="#f4f6fa" />
      <path d="M70 19 Q74 16 79 18 L78 21 Q74 22 70 21 Z" fill="#2b3346" />
      {/* nose flash */}
      <path d="M120 29 L140 35 Q143 36 140 37 L126 37 Z" fill="#f4f6fa" opacity="0.92" />
      {/* front wing — forward of the front wheel, where it actually sits */}
      <rect x="120" y="41" width="30" height="5" rx="2.5" fill="var(--body)" />
      <rect x="126" y="46" width="20" height="3" rx="1.5" fill="#10131a" opacity="0.8" />
      <rect x="143" y="33" width="5" height="16" rx="2.5" fill="#10131a" />

      <Wheel cx={38} cy={40} />
      <Wheel cx={108} cy={40} />
    </svg>
  )
}

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="15" fill="#191d25" />
      <circle cx={cx} cy={cy} r="15" fill="none" stroke="#333b4b" strokeWidth="1.6" />
      <g className="rc-wheel" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r="7.2" fill="#d7dde8" />
        <rect x={cx - 7.6} y={cy - 1.4} width="15.2" height="2.8" rx="1.4" fill="#8d97a8" />
        <rect x={cx - 1.4} y={cy - 7.6} width="2.8" height="15.2" rx="1.4" fill="#8d97a8" />
      </g>
    </g>
  )
}
