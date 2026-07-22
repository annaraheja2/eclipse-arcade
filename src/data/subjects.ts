// Arcade content: Course → Units → Subunits. Difficulty + answer-type live on the SUBUNIT.
// Units carry an optional one-line description. Most units below ship EMPTY —
// admins author their subunits/questions in /admin (Firestore, per-course doc).
// Algebra 1 keeps playable bundled content so vs-AI is never empty out of the box.

export type AnswerType = 'graph' | 'slider' | 'fill'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Question {
  prompt: string
  // graph:
  x?: number; y?: number; range?: number
  // slider:
  answer?: number; min?: number; max?: number; step?: number
  // fill:
  fill?: string
  // optional one-line elaboration / method hint (shown when authored)
  explain?: string
}

export interface Subunit {
  id: string
  name: string
  difficulty: Difficulty
  type: AnswerType
  questions: Question[]
}
export interface Unit { id: string; name: string; description?: string; subunits: Subunit[] }
export interface Course { id: string; name: string; units: Unit[] }

const g = (prompt: string, x: number, y: number, range = 8, explain?: string): Question => ({ prompt, x, y, range, explain })
const s = (prompt: string, answer: number, min: number, max: number, step = 0.5, explain?: string): Question => ({ prompt, answer, min, max, step, explain })
const f = (prompt: string, fill: string): Question => ({ prompt, fill })

// Lightweight metadata for pickers that must list courses without loading each
// one's content (which loadCourse fetches lazily).
export interface CourseInfo { id: string; name: string }
export const COURSE_LIST: readonly CourseInfo[] = [
  { id: 'algebra-1', name: 'Algebra 1' },
  { id: 'geometry', name: 'Geometry' },
  { id: 'algebra-2', name: 'Algebra 2' },
  { id: 'precalculus', name: 'Precalculus' },
]

// Empty unit shorthand (subunits authored later by admins).
const u = (id: string, name: string, description?: string): Unit =>
  description === undefined ? { id, name, subunits: [] } : { id, name, description, subunits: [] }

export const COURSES: Course[] = [
  {
    id: 'algebra-1', name: 'Algebra 1',
    units: [
      {
        id: 'foundations-of-algebra', name: 'Foundations of Algebra',
        description: 'variables, expressions, order of operations',
        subunits: [
          { id: 'terms', name: 'Key Terms', difficulty: 'easy', type: 'fill', questions: [
            f('The number multiplying a variable is the ______.', 'coefficient'),
            f('A letter that stands for an unknown is a ______.', 'variable'),
            f('Terms with the same variable are ______ terms.', 'like'),
            f('50% as a decimal is ______.', '0.5'),
          ]},
        ],
      },
      {
        id: 'solving-linear-equations', name: 'Solving Linear Equations',
        description: 'one-step to multi-step equations',
        subunits: [
          { id: 'one-step', name: 'One-Step', difficulty: 'easy', type: 'slider', questions: [
            s('Solve:  x + 5 = 12', 7, 0, 20), s('Solve:  x − 3 = 4', 7, 0, 20),
            s('Solve:  3x = 15', 5, 0, 20), s('Solve:  x ÷ 2 = 6', 12, 0, 24),
          ]},
          { id: 'two-step', name: 'Two-Step', difficulty: 'medium', type: 'slider', questions: [
            s('Solve:  2x + 4 = 10', 3, -5, 15, 0.5, 'Undo the +4 first, then undo the ×2.'),
            s('Solve:  3x − 5 = 10', 5, 0, 20, 0.5, 'Add 5 to both sides, then divide by 3.'),
            s('Solve:  x ÷ 3 + 2 = 6', 12, 0, 24), s('Solve:  5x + 1 = 26', 5, 0, 20),
          ]},
          { id: 'multi-step', name: 'Multi-Step', difficulty: 'hard', type: 'slider', questions: [
            s('Solve:  5x − 3 = 2x + 9', 4, -5, 15), s('Solve:  2(x + 3) = 14', 4, -5, 15),
            s('Solve:  4x + 2 = 2(x + 7)', 6, -5, 15), s('Solve:  3(x − 1) = 2x + 4', 7, -5, 20),
          ]},
        ],
      },
      u('linear-inequalities', 'Linear Inequalities', 'graphing and solving'),
      u('functions-and-relations', 'Functions & Relations', 'function notation, domain, range'),
      {
        id: 'linear-functions', name: 'Linear Functions',
        description: 'slope, intercepts, graphing',
        subunits: [
          { id: 'plot', name: 'Plot a Point', difficulty: 'easy', type: 'graph', questions: [
            g('Plot the point  (3, 2)', 3, 2), g('Plot the point  (−4, 1)', -4, 1),
            g('Plot the point  (0, −3)', 0, -3), g('Plot the point  (2, 5)', 2, 5),
          ]},
          { id: 'intercepts', name: 'Intercepts', difficulty: 'medium', type: 'graph', questions: [
            g('y-intercept of  y = 2x + 3', 0, 3, 8, 'For a y-intercept, set x = 0 and read off y.'),
            g('x-intercept of  y = 2x − 4', 2, 0, 8, 'For an x-intercept, set y = 0 and solve for x.'),
            g('y-intercept of  y = −x + 5', 0, 5), g('x-intercept of  y = 3x − 6', 2, 0),
          ]},
        ],
      },
      u('systems-of-equations', 'Systems of Equations', 'graphing, substitution, elimination'),
      u('exponents-and-exponential-functions', 'Exponents & Exponential Functions'),
      u('polynomials', 'Polynomials', 'adding, subtracting, multiplying'),
      u('factoring', 'Factoring', 'trinomials, special products'),
      {
        id: 'quadratic-functions', name: 'Quadratic Functions',
        description: 'graphing, vertex form, standard form',
        subunits: [
          { id: 'vertex', name: 'Parabola Vertex', difficulty: 'hard', type: 'graph', questions: [
            g('Vertex of  y = (x − 2)² − 1', 2, -1), g('Vertex of  y = (x + 1)² − 4', -1, -4),
            g('Vertex of  y = (x − 3)² + 2', 3, 2), g('Vertex of  y = (x + 2)²', -2, 0),
          ]},
        ],
      },
      u('solving-quadratics', 'Solving Quadratics', 'factoring, completing the square, quadratic formula'),
      u('data-and-statistics', 'Data & Statistics', 'scatter plots, lines of best fit'),
    ],
  },
  {
    id: 'geometry', name: 'Geometry',
    units: [
      u('foundations-and-logic', 'Foundations & Logic', 'points, lines, proofs'),
      u('transformations', 'Transformations', 'reflections, rotations, translations, dilations'),
      u('congruence', 'Congruence', 'SSS, SAS, ASA, AAS, HL'),
      u('similarity', 'Similarity', 'proportionality, scale factors'),
      u('right-triangles-and-trigonometry', 'Right Triangles & Trigonometry', 'SOH-CAH-TOA, special triangles'),
      u('quadrilaterals', 'Quadrilaterals', 'parallelograms, rectangles, rhombi'),
      u('circles', 'Circles', 'arcs, chords, angles, sectors'),
      u('coordinate-geometry', 'Coordinate Geometry', 'distance, midpoint, slope proofs'),
      u('area-and-volume', 'Area & Volume', '2D and 3D shapes'),
      u('probability', 'Probability', 'geometric probability'),
    ],
  },
  {
    id: 'algebra-2', name: 'Algebra 2',
    units: [
      u('linear-and-absolute-value-functions', 'Linear & Absolute Value Functions'),
      u('systems-and-matrices', 'Systems & Matrices'),
      u('quadratic-functions', 'Quadratic Functions', 'transformations, complex roots'),
      u('polynomials', 'Polynomials', 'division, synthetic division, theorems'),
      u('rational-expressions-and-functions', 'Rational Expressions & Functions'),
      u('radical-functions', 'Radical Functions'),
      u('exponential-and-logarithmic-functions', 'Exponential & Logarithmic Functions'),
      u('sequences-and-series', 'Sequences & Series', 'arithmetic, geometric'),
      u('probability-and-statistics', 'Probability & Statistics'),
      u('trigonometric-functions', 'Trigonometric Functions', 'unit circle intro'),
    ],
  },
  {
    id: 'precalculus', name: 'Precalculus',
    units: [
      u('functions-and-their-graphs', 'Functions & Their Graphs'),
      u('polynomial-and-rational-functions', 'Polynomial & Rational Functions'),
      u('exponential-and-logarithmic-functions', 'Exponential & Logarithmic Functions'),
      u('trigonometric-functions', 'Trigonometric Functions', 'unit circle, identities'),
      u('trigonometric-identities-and-equations', 'Trigonometric Identities & Equations'),
      u('systems-and-matrices', 'Systems & Matrices'),
      u('sequences-series-and-sigma-notation', 'Sequences, Series & Sigma Notation'),
      u('vectors', 'Vectors'),
      u('parametric-and-polar-equations', 'Parametric & Polar Equations'),
      u('limits-and-intro-to-calculus', 'Limits & Intro to Calculus'),
    ],
  },
]

export function getCourse(id: string) { return COURSES.find((c) => c.id === id) }
