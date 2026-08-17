// End-of-session stats: what a player answered, broken down by subtopic.
//
// Every question-gated surface (the games and the Practice tab) collects an
// AnsweredItem per answer while it plays, then hands the list here at the end.
// Nothing is persisted — this describes ONE session, so the caller keeps the
// list in React state and throws it away afterwards.
//
// Pure. The rendering lives in components/SessionSummary.tsx.
import type { Question, Subunit } from '../data/subjects'

/**
 * A question paired with the subtopic it came from.
 *
 * Games draw from a pool built out of several subtopics. Flattening that pool
 * to bare Questions — which every game used to do — loses the one fact the
 * summary needs, so pools hold these instead.
 */
export interface TaggedQuestion {
  q: Question
  subunitId: string
  subunitName: string
}

/** Every question in `subunits`, each tagged with its subtopic. */
export function taggedPool(subunits: readonly Subunit[]): TaggedQuestion[] {
  return subunits.flatMap((s) => s.questions.map((q) => ({ q, subunitId: s.id, subunitName: s.name })))
}

/** One graded answer, tagged with the subtopic it came from. */
export interface AnsweredItem {
  subunitId: string
  subunitName: string
  correct: boolean
}

export interface SubtopicTally {
  subunitId: string
  name: string
  answered: number
  correct: number
  /** 0–100, rounded. */
  pct: number
}

export interface SessionSummary {
  answered: number
  correct: number
  /** 0–100, rounded. 0 when nothing was answered. */
  pct: number
  /** Every subtopic seen, weakest first (ties broken by most-answered). */
  bySubtopic: SubtopicTally[]
  /** Worth reviewing — see MIN_FOR_VERDICT / STRUGGLING_PCT. */
  struggling: SubtopicTally[]
  /** Going well — same attempt floor, see STRONG_PCT. */
  strong: SubtopicTally[]
}

// A verdict on one or two answers is noise, so a subtopic needs a minimum
// number of attempts before the summary calls it a strength or a weakness.
// Games are short (5 rounds is common), so the floor is deliberately low.
export const MIN_FOR_VERDICT = 2
export const STRUGGLING_PCT = 60
export const STRONG_PCT = 80

const pctOf = (correct: number, answered: number) =>
  answered === 0 ? 0 : Math.round((correct / answered) * 100)

/**
 * Tallies a session's answers by subtopic. Subtopics come out weakest-first so
 * the thing worth reviewing is what a player reads first; `struggling` and
 * `strong` are the subsets confident enough to label.
 */
export function summarize(items: readonly AnsweredItem[]): SessionSummary {
  const byId = new Map<string, SubtopicTally>()
  for (const item of items) {
    let tally = byId.get(item.subunitId)
    if (!tally) {
      tally = { subunitId: item.subunitId, name: item.subunitName, answered: 0, correct: 0, pct: 0 }
      byId.set(item.subunitId, tally)
    }
    tally.answered += 1
    if (item.correct) tally.correct += 1
  }

  const bySubtopic = [...byId.values()]
  for (const t of bySubtopic) t.pct = pctOf(t.correct, t.answered)
  // weakest first; a subtopic answered more often is the more reliable signal,
  // so it wins a tie on accuracy.
  bySubtopic.sort((a, b) => a.pct - b.pct || b.answered - a.answered)

  const rated = bySubtopic.filter((t) => t.answered >= MIN_FOR_VERDICT)
  const correct = items.reduce((n, i) => n + (i.correct ? 1 : 0), 0)

  return {
    answered: items.length,
    correct,
    pct: pctOf(correct, items.length),
    bySubtopic,
    struggling: rated.filter((t) => t.pct < STRUGGLING_PCT),
    strong: rated.filter((t) => t.pct >= STRONG_PCT),
  }
}

// ---------------------------------------------------------------------------
// The flat aim-and-fire loop (Daily Challenge)
// ---------------------------------------------------------------------------
//
// Daily runs on lib/games.ts, not the curriculum: its rounds carry no subtopic,
// and there is no right or wrong — a shot scores 0..max by how close it landed.
// So it can't use summarize() above. It gets the same readout built from what it
// DOES measure: the score as a percentage, grouped by the only division the flat
// model has — whether you were plotting a point or solving for a value.

/** One finished round of the flat loop. `score` runs 0..max. */
export interface ScoredRound { kind: 'pin' | 'slider'; score: number }

/** Half marks is the flat loop's own hit line — `Game.tsx` already plays the
 *  hit sound and the happy face above it, so the summary agrees with the game. */
export const ON_TARGET = 0.5

const KIND_LABEL: Record<ScoredRound['kind'], string> = {
  pin: 'Plotting points',
  slider: 'Solving for a value',
}

/** Scored rounds as a summary: accuracy is the share of the available points. */
export function summarizeRounds(rounds: readonly ScoredRound[], max: number): SessionSummary {
  if (rounds.length === 0 || max <= 0) return summarize([])

  const groups = new Map<ScoredRound['kind'], { rounds: number; onTarget: number; points: number }>()
  let onTarget = 0
  let points = 0
  for (const r of rounds) {
    const hit = r.score >= max * ON_TARGET
    if (hit) onTarget += 1
    points += r.score
    const g = groups.get(r.kind) ?? { rounds: 0, onTarget: 0, points: 0 }
    g.rounds += 1
    g.points += r.score
    if (hit) g.onTarget += 1
    groups.set(r.kind, g)
  }

  const bySubtopic: SubtopicTally[] = [...groups.entries()].map(([kind, g]) => ({
    subunitId: kind,
    name: KIND_LABEL[kind],
    answered: g.rounds,
    correct: g.onTarget,
    pct: Math.round((g.points / (g.rounds * max)) * 100),
  }))
  bySubtopic.sort((a, b) => a.pct - b.pct || b.answered - a.answered)

  const rated = bySubtopic.filter((t) => t.answered >= MIN_FOR_VERDICT)
  return {
    answered: rounds.length,
    correct: onTarget,
    pct: Math.round((points / (rounds.length * max)) * 100),
    bySubtopic,
    struggling: rated.filter((t) => t.pct < STRUGGLING_PCT),
    strong: rated.filter((t) => t.pct >= STRONG_PCT),
  }
}
