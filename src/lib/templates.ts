// Question templates: write the shape of a question once, get unlimited
// versions of it.
//
// A template is a prompt with holes, a range for each hole, and an expression
// that WORKS OUT the answer from whatever numbers got drawn. That last part is
// the point — the answer is computed, never stored and never predicted, so a
// generated question cannot grade a student wrong.
//
// Only slider and graph questions can be generated. `fill` is deliberately
// excluded: the grader has no alternate-answer support (see data/types.ts), so
// a generated "x = 5" would mark a student typing "5" wrong. Numbers belong on
// a slider anyway.
//
// Pure. Expressions are evaluated by lib/expr.ts, which never uses eval.
import type { Question } from '../data/subjects'
import { evaluate, holds, namesUsed, type Vars } from './expr'

/** One hole in the prompt. Values are drawn from min..max in steps of `step`. */
export interface TemplateVar {
  name: string
  min: number
  max: number
  /** Defaults to 1 — whole numbers, which is what most questions want. */
  step?: number
}

export interface QuestionTemplate {
  id: string
  /** The subtopic this belongs to, matching a Subunit id. */
  subunitId: string
  kind: 'slider' | 'graph'
  /** Prompt text with {name} holes: "A sequence starts at {a}…". */
  prompt: string
  vars: TemplateVar[]
  /** Values worked out from the drawn variables, in order, each able to use the
   *  ones before it. They can appear in the prompt and in any expression — which
   *  is how an equation shows its right-hand side without the author having to
   *  draw it and then constrain it. */
  lets?: { name: string; expr: string }[]
  /** Guards every draw must satisfy, e.g. "a % b == 0" to keep answers whole.
   *  A draw that fails them is thrown away and re-rolled. */
  where?: string[]
  /** slider: the value being solved for, and the track it sits on. */
  answer?: string
  min?: string
  max?: string
  step?: number
  /** graph: the point, and the half-width of the grid. */
  x?: string
  y?: string
  range?: number
  /** Optional method hint, templated the same way as the prompt. */
  explain?: string
}

/** How many draws to try before giving up on the guards. */
const MAX_DRAWS = 60

export type Instantiated =
  | { ok: true; question: Question; vars: Vars }
  | { ok: false; reason: string }

const isInt = (n: number) => Number.isInteger(n)

/** Fills {name} holes. An unknown hole is left alone so it's visible, not silent. */
export function fillPrompt(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole)
}

function drawVars(t: QuestionTemplate, rng: () => number): Vars {
  const out: Record<string, number> = {}
  for (const v of t.vars) {
    const step = v.step && v.step > 0 ? v.step : 1
    const steps = Math.floor((v.max - v.min) / step)
    const n = v.min + step * Math.floor(rng() * (steps + 1))
    // Re-round to the step so floating point doesn't leave 2.9999999 in a prompt.
    out[v.name] = Math.round(n / step) * step
  }
  return out
}

/**
 * Static checks an author's template must pass before it can be drawn from.
 * Returns a human-readable problem, or null when the template is sound.
 */
export function templateIssue(t: QuestionTemplate): string | null {
  if (t.vars.length === 0 && namesUsed(t.prompt).length > 0) return 'The prompt has holes but no variables are defined.'
  const names = new Set<string>()
  for (const v of t.vars) {
    if (!/^[A-Za-z_]\w*$/.test(v.name)) return `"${v.name}" is not a usable variable name.`
    if (names.has(v.name)) return `Variable "${v.name}" is defined twice.`
    names.add(v.name)
    if (!(v.max > v.min)) return `Variable "${v.name}" needs max greater than min.`
    if (v.step !== undefined && !(v.step > 0)) return `Variable "${v.name}" needs a positive step.`
  }
  const known = (src: string, where: string): string | null => {
    for (const n of namesUsed(src)) {
      if (!names.has(n)) return `${where} uses "${n}", which is not one of the variables.`
    }
    return null
  }
  // Derived values are checked in order and then join the known names, so a
  // later one may build on an earlier one but not on itself.
  for (const l of t.lets ?? []) {
    if (!/^[A-Za-z_]\w*$/.test(l.name)) return `"${l.name}" is not a usable name.`
    if (names.has(l.name)) return `"${l.name}" is defined twice.`
    const bad = known(l.expr, `The value "${l.name}"`)
    if (bad) return bad
    names.add(l.name)
  }
  const exprs: [string | undefined, string][] = t.kind === 'slider'
    ? [[t.answer, 'The answer'], [t.min, 'The track minimum'], [t.max, 'The track maximum']]
    : [[t.x, 'The x value'], [t.y, 'The y value']]
  for (const [src, where] of exprs) {
    if (src === undefined) return `${where} is missing.`
    const bad = known(src, where)
    if (bad) return bad
  }
  for (const g of t.where ?? []) {
    const bad = known(g, 'A guard')
    if (bad) return bad
  }
  if (t.kind === 'slider' && t.step !== undefined && !(t.step > 0)) return 'The slider step must be positive.'
  if (t.kind === 'graph' && t.range !== undefined && !(t.range > 0)) return 'The grid range must be positive.'
  return null
}

/**
 * Draws one concrete question from a template.
 *
 * Every draw is checked against the same rules the hand-authored content obeys
 * (data/courses.test.ts enforces them there): a slider answer has to sit on its
 * track and land on the step, a graph point has to fit inside the grid. A draw
 * that misses is re-rolled rather than shown — which is what makes a generated
 * question safe to put in front of a student.
 */
export function instantiate(t: QuestionTemplate, rng: () => number): Instantiated {
  const issue = templateIssue(t)
  if (issue) return { ok: false, reason: issue }

  for (let attempt = 0; attempt < MAX_DRAWS; attempt++) {
    const drawn: Record<string, number> = { ...drawVars(t, rng) }
    let derailed = false
    for (const l of t.lets ?? []) {
      const r = evaluate(l.expr, drawn)
      if (!r.ok) { derailed = true; break }
      drawn[l.name] = r.value
    }
    if (derailed) continue
    const vars: Vars = drawn
    if ((t.where ?? []).some((g) => !holds(g, vars))) continue

    const num = (src: string): number | null => {
      const r = evaluate(src, vars)
      return r.ok ? r.value : null
    }

    if (t.kind === 'slider') {
      const answer = num(t.answer!)
      const min = num(t.min!)
      const max = num(t.max!)
      if (answer === null || min === null || max === null) continue
      if (!(min < max)) continue
      const step = t.step && t.step > 0 ? t.step : 0.5
      // The handle snaps to the step and grades within ±step, so an answer off
      // the step would make the neighbouring tick correct too.
      if (!isInt(answer / step)) continue
      if (answer < min || answer > max) continue
      // A track wider than ~100 steps can't be aimed on a phone.
      if ((max - min) / step > 100) continue
      const q: Question = { prompt: fillPrompt(t.prompt, vars), answer, min, max, step }
      if (t.explain) q.explain = fillPrompt(t.explain, vars)
      return { ok: true, question: q, vars }
    }

    const x = num(t.x!)
    const y = num(t.y!)
    if (x === null || y === null) continue
    const range = t.range && t.range > 0 ? t.range : 8
    // Graph answers are graded within ±0.5 per axis, so they must be reachable
    // on the grid and land on a half unit.
    if (!isInt(x * 2) || !isInt(y * 2)) continue
    if (Math.abs(x) > range || Math.abs(y) > range) continue
    const q: Question = { prompt: fillPrompt(t.prompt, vars), x, y, range }
    if (t.explain) q.explain = fillPrompt(t.explain, vars)
    return { ok: true, question: q, vars }
  }

  return { ok: false, reason: 'Could not find numbers that satisfy this template — check its ranges and guards.' }
}

/** Draws `n` questions, skipping any that fail. May return fewer than asked. */
export function instantiateMany(t: QuestionTemplate, n: number, rng: () => number): Question[] {
  const out: Question[] = []
  for (let i = 0; i < n; i++) {
    const r = instantiate(t, rng)
    if (r.ok) out.push(r.question)
  }
  return out
}
