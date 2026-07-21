// Arcade content: Course → Units → Subunits. Difficulty + answer-type live on the SUBUNIT.
// (Sample questions for now — the team supplies real ones later.)

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
}

export interface Subunit {
  id: string
  name: string
  difficulty: Difficulty
  type: AnswerType
  questions: Question[]
}
export interface Unit { id: string; name: string; subunits: Subunit[] }
export interface Course { id: string; name: string; units: Unit[] }

const g = (prompt: string, x: number, y: number, range = 8): Question => ({ prompt, x, y, range })
const s = (prompt: string, answer: number, min: number, max: number, step = 0.5): Question => ({ prompt, answer, min, max, step })
const f = (prompt: string, fill: string): Question => ({ prompt, fill })

export const COURSES: Course[] = [
  {
    id: 'algebra-1', name: 'Algebra 1',
    units: [
      {
        id: 'u-equations', name: 'Solving Linear Equations',
        subunits: [
          { id: 'one-step', name: 'One-Step', difficulty: 'easy', type: 'slider', questions: [
            s('Solve:  x + 5 = 12', 7, 0, 20), s('Solve:  x − 3 = 4', 7, 0, 20),
            s('Solve:  3x = 15', 5, 0, 20), s('Solve:  x ÷ 2 = 6', 12, 0, 24),
          ]},
          { id: 'two-step', name: 'Two-Step', difficulty: 'medium', type: 'slider', questions: [
            s('Solve:  2x + 4 = 10', 3, -5, 15), s('Solve:  3x − 5 = 10', 5, 0, 20),
            s('Solve:  x ÷ 3 + 2 = 6', 12, 0, 24), s('Solve:  5x + 1 = 26', 5, 0, 20),
          ]},
          { id: 'multi-step', name: 'Multi-Step', difficulty: 'hard', type: 'slider', questions: [
            s('Solve:  5x − 3 = 2x + 9', 4, -5, 15), s('Solve:  2(x + 3) = 14', 4, -5, 15),
            s('Solve:  4x + 2 = 2(x + 7)', 6, -5, 15), s('Solve:  3(x − 1) = 2x + 4', 7, -5, 20),
          ]},
        ],
      },
      {
        id: 'u-graphing', name: 'Graphing Lines',
        subunits: [
          { id: 'plot', name: 'Plot a Point', difficulty: 'easy', type: 'graph', questions: [
            g('Plot the point  (3, 2)', 3, 2), g('Plot the point  (−4, 1)', -4, 1),
            g('Plot the point  (0, −3)', 0, -3), g('Plot the point  (2, 5)', 2, 5),
          ]},
          { id: 'intercepts', name: 'Intercepts', difficulty: 'medium', type: 'graph', questions: [
            g('y-intercept of  y = 2x + 3', 0, 3), g('x-intercept of  y = 2x − 4', 2, 0),
            g('y-intercept of  y = −x + 5', 0, 5), g('x-intercept of  y = 3x − 6', 2, 0),
          ]},
          { id: 'vertex', name: 'Parabola Vertex', difficulty: 'hard', type: 'graph', questions: [
            g('Vertex of  y = (x − 2)² − 1', 2, -1), g('Vertex of  y = (x + 1)² − 4', -1, -4),
            g('Vertex of  y = (x − 3)² + 2', 3, 2), g('Vertex of  y = (x + 2)²', -2, 0),
          ]},
        ],
      },
      {
        id: 'u-vocab', name: 'Foundations & Vocabulary',
        subunits: [
          { id: 'terms', name: 'Key Terms', difficulty: 'easy', type: 'fill', questions: [
            f('The number multiplying a variable is the ______.', 'coefficient'),
            f('A letter that stands for an unknown is a ______.', 'variable'),
            f('Terms with the same variable are ______ terms.', 'like'),
            f('50% as a decimal is ______.', '0.5'),
          ]},
        ],
      },
    ],
  },
]

export function getCourse(id: string) { return COURSES.find((c) => c.id === id) }
