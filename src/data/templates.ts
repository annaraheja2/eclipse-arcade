// Question templates, one or more per subtopic.
//
// Each entry is a question type written once: the prompt with holes, the range
// each hole draws from, and the expression that works out the answer. The app
// then produces as many versions as a student wants, instantly and for nothing,
// and the answer is always right because it is calculated rather than stored.
//
// Writing one:
//   * `vars` are the numbers drawn at random; `lets` are values worked out from
//     them (an equation's right-hand side, say) and can appear in the prompt too
//   * `where` guards throw a draw away and re-roll it — the usual use is keeping
//     an answer whole
//   * only slider and graph types exist here on purpose: `fill` has no
//     alternate-answer support, so a generated one would mark a right answer
//     wrong (see lib/templates.ts)
//
// `subunitId` is the slug of the curriculum topic name — 'Multi-Step Equations'
// becomes 'multi-step-equations'. templates.test.ts checks every id here exists
// in the curriculum, so a renamed topic can't silently orphan its template.
import type { QuestionTemplate } from '../lib/templates'

export const TEMPLATES: readonly QuestionTemplate[] = [
  {
    id: 'evaluate-linear',
    subunitId: 'evaluating-expressions',
    kind: 'slider',
    prompt: 'Evaluate  {m}a + {b}  when  a = {v}',
    vars: [
      { name: 'm', min: 2, max: 9 },
      { name: 'b', min: 1, max: 12 },
      { name: 'v', min: 2, max: 9 },
    ],
    answer: 'm * v + b',
    min: '0',
    max: '100',
    step: 1,
    explain: 'Substitute a = {v}:  {m}·{v} + {b}.',
  },

  {
    id: 'two-step-equation',
    subunitId: 'one-step-two-step-equations',
    kind: 'slider',
    // c is worked out from the answer, so the equation always comes out whole.
    prompt: 'Solve for x:   {a}x + {b} = {c}',
    vars: [
      { name: 'a', min: 2, max: 9 },
      { name: 'x', min: 1, max: 12 },
      { name: 'b', min: 1, max: 15 },
    ],
    lets: [{ name: 'c', expr: 'a * x + b' }],
    answer: 'x',
    min: '0',
    max: '15',
    step: 1,
    explain: 'Take away {b} to get {a}x = {c} − {b}, then divide by {a}.',
  },

  {
    id: 'variable-both-sides',
    subunitId: 'multi-step-equations',
    kind: 'slider',
    prompt: 'Solve for x:   {a}x + {b} = {d}x + {c}',
    vars: [
      { name: 'a', min: 4, max: 9 },
      { name: 'd', min: 1, max: 5 },
      { name: 'x', min: 1, max: 10 },
      { name: 'b', min: 1, max: 12 },
    ],
    lets: [{ name: 'c', expr: 'a * x + b - d * x' }],
    // A positive right-hand constant, and the x terms must not cancel.
    where: ['a > d', 'c > 0'],
    answer: 'x',
    min: '0',
    max: '12',
    step: 1,
    explain: 'Collect the x terms: ({a} − {d})x = {c} − {b}.',
  },

  {
    id: 'function-value',
    subunitId: 'function-notation-evaluation',
    kind: 'slider',
    prompt: 'f(x) = {m}x + {b}.   Find  f({k}).',
    vars: [
      { name: 'm', min: 2, max: 9 },
      { name: 'b', min: 1, max: 9 },
      { name: 'k', min: 1, max: 9 },
    ],
    answer: 'm * k + b',
    min: '0',
    max: '100',
    step: 1,
    explain: 'Put {k} in for x:  {m}·{k} + {b}.',
  },

  {
    id: 'y-intercept-point',
    subunitId: 'linear-functions',
    kind: 'graph',
    prompt: 'Plot the y-intercept of   y = {m}x + {b}',
    vars: [
      { name: 'm', min: 1, max: 6 },
      { name: 'b', min: -7, max: 7 },
    ],
    // The intercept sits on the axis, so the x hole is a constant.
    x: '0',
    y: 'b',
    range: 8,
    explain: 'The y-intercept is where x = 0, so y = {b}.',
  },
]

/** Every template written for a subtopic. Empty when none has been written. */
export function templatesFor(subunitId: string): QuestionTemplate[] {
  return TEMPLATES.filter((t) => t.subunitId === subunitId)
}

/** True when a subtopic can generate more questions of the same shape. */
export function hasTemplate(subunitId: string): boolean {
  return TEMPLATES.some((t) => t.subunitId === subunitId)
}
