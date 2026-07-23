// Pure race simulation for the Racer game. Every function here is deterministic
// given its inputs — the only source of chance is an INJECTED `rng: () => number`
// (Math.random at the page edge, a seeded generator in tests). No Date.now /
// Math.random lives in this file, so the whole model is unit-testable.
//
// Cars cruise CONTINUOUSLY: distance += speed × dt every frame. Answering a
// question only nudges a car's SPEED (correct +2, wrong −2); the car keeps
// moving on its own at whatever speed it currently holds. A car at 0 mph is
// stopped until it answers correctly again.

import type { Difficulty } from '../data/subjects'

export const RACE_SECONDS = 180 // a 3:00 round
export const COUNTDOWN_SECONDS = 3 // "3 · 2 · 1 · GO" before the flag drops
export const START_MPH = 10
export const MAX_MPH = 30 // speed cap — nobody runs away uncatchably
export const MIN_MPH = 0 // a stopped car must answer correctly to move again
export const SPEED_STEP = 2 // correct → +2 mph, wrong → −2 mph

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** New speed after an answer, clamped to [0, MAX_MPH]. */
export function applyAnswer(speed: number, correct: boolean): number {
  return clamp(speed + (correct ? SPEED_STEP : -SPEED_STEP), MIN_MPH, MAX_MPH)
}

/** Distance after cruising `dt` seconds at `speedMph` — the continuous integrator. */
export function advanceDistance(distance: number, speedMph: number, dt: number): number {
  return distance + speedMph * dt
}

/**
 * How far along the track a car is, 0..1. Normalised by the theoretical ceiling
 * (a whole race pinned at the cap), so the leader nears — but rarely reaches —
 * the finish exactly as the clock runs out, and relative gaps read clearly.
 */
export function trackFraction(distance: number): number {
  return clamp(distance / (RACE_SECONDS * MAX_MPH), 0, 1)
}

export interface BaseCar { id: string; name: string; color: string; speed: number; distance: number }
export interface PlayerCar extends BaseCar { kind: 'player' }
export interface AiCar extends BaseCar {
  kind: 'ai'
  correctRate: number // P(correct) each time this AI answers
  cadenceMin: number // seconds between answers (min)
  cadenceMax: number // seconds between answers (max)
  cooldown: number // seconds until this AI's next answer
}
export type Car = PlayerCar | AiCar

/**
 * Advance one AI by `dt`: count its cooldown down; when it fires, roll `rng()`
 * against the correct-rate to nudge speed, then re-arm the cooldown to a fresh
 * random cadence. Pure — two `rng()` draws per fired answer, none otherwise.
 * Distance is untouched here; the shared integrator cruises every car.
 */
export function stepAi(car: AiCar, dt: number, rng: () => number): AiCar {
  const cooldown = car.cooldown - dt
  if (cooldown > 0) return { ...car, cooldown }
  const correct = rng() < car.correctRate
  const speed = applyAnswer(car.speed, correct)
  const cadence = car.cadenceMin + rng() * (car.cadenceMax - car.cadenceMin)
  return { ...car, speed, cooldown: cadence }
}

/**
 * One simulation frame: step each AI's answering, then cruise EVERY car forward
 * at its current speed. The player's speed only changes when they answer (in the
 * page); here their car simply keeps moving. Pure — `rng` injected for the AI.
 */
export function stepRace(cars: Car[], dt: number, rng: () => number): Car[] {
  return cars.map((car) => {
    const advanced = car.kind === 'ai' ? stepAi(car, dt, rng) : car
    return { ...advanced, distance: advanceDistance(advanced.distance, advanced.speed, dt) }
  })
}

/** Cars sorted leader-first by distance (stable tie-break: speed, then id). */
export function rank(cars: Car[]): Car[] {
  return [...cars].sort((a, b) => b.distance - a.distance || b.speed - a.speed || a.id.localeCompare(b.id))
}

/** 1-based finishing place of `id` in the field (1 = winner). 0 if absent. */
export function placementOf(cars: Car[], id: string): number {
  return rank(cars).findIndex((c) => c.id === id) + 1
}

/** "1st" / "2nd" / "3rd" / "4th"… for plain-text standings. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ---- AI tuning ------------------------------------------------------------
// Three fixed, competitive-but-beatable baselines, spread so the field
// separates. Paced against a HUMAN answer rhythm: the pace-setter climbs at
// ~0.25 mph/s (reaching the cap around the mid-race, not the opening), so it's
// a real threat to the flag. A player who answers every ~5s at ~85% just
// out-accelerates it and wins the MAJORITY of the time — but not every time,
// and a median run genuinely fights for the podium. `difficulty` nudges the
// whole field's accuracy so a hard topic fields tougher rivals.
export interface AiTuning { correctRate: number; cadenceMin: number; cadenceMax: number }
const BASE_TUNINGS: readonly AiTuning[] = [
  { correctRate: 0.80, cadenceMin: 4.0, cadenceMax: 5.5 }, // the pace-setter
  { correctRate: 0.72, cadenceMin: 5.0, cadenceMax: 6.5 }, // the midfielder
  { correctRate: 0.64, cadenceMin: 6.0, cadenceMax: 8.0 }, // the backmarker
]
const DIFFICULTY_ACCURACY: Record<Difficulty, number> = { easy: -0.06, medium: 0, hard: 0.06 }

export function aiTuningsFor(difficulty: Difficulty): AiTuning[] {
  const d = DIFFICULTY_ACCURACY[difficulty]
  return BASE_TUNINGS.map((t) => ({ ...t, correctRate: clamp(t.correctRate + d, 0, 1) }))
}

// Opening grace: an AI's FIRST answer waits a randomised reaction window on
// top of a normal cadence draw, so the human gets their first answer or two in
// before the field starts to pull — no rival leaps off the line.
export const AI_GRACE_MIN = 4
export const AI_GRACE_MAX = 7

/** Cooldown an AI starts the race with: reaction grace + one cadence draw. */
export function initialCooldown(t: AiTuning, rng: () => number): number {
  const grace = AI_GRACE_MIN + rng() * (AI_GRACE_MAX - AI_GRACE_MIN)
  return grace + t.cadenceMin + rng() * (t.cadenceMax - t.cadenceMin)
}

// ---- Scoring --------------------------------------------------------------
// Distance carries most of the score (how well you actually drove); a podium
// bonus rewards the finish. The exponential "close still pays" curve of the
// aiming games isn't apt for a timed race, so distance scores linearly:
//   score = round(trackFraction(distance) × 3000) + placementBonus
// A dominant win lands ~4400; a mid-pack run ~2000; a stalled last place a few
// hundred. rewardsFor(score) then maps that to XP/coins like every other game.
const PLACEMENT_BONUS = [1500, 800, 300, 0] as const
export function raceScore(distance: number, placement: number): number {
  const bonus = PLACEMENT_BONUS[placement - 1] ?? 0
  return Math.round(trackFraction(distance) * 3000) + bonus
}
