// Curriculum content over Firestore — collection `arcadeContent`, ONE DOC PER
// COURSE (doc id = course id) mirroring the bundled Course shape plus
// updatedAt/updatedBy metadata. Content is tiny (well under the 1MB doc
// limit), so whole-doc read/write keeps loading trivial and edits atomic.
//
// Split like the rest of lib/: validateCourse is pure (unit-tested); the
// Firestore calls live at the bottom and follow the lazy-SDK pattern from
// lib/firebase.ts. Game code calls loadCourse, which NEVER throws to the UI —
// unconfigured, missing, invalid, or unreachable all fall back to the bundled
// course. Admin code uses fetchRemoteCourse/saveCourse, where errors propagate.
import { getCourse, type Course, type Unit, type Subunit, type Question, type Difficulty, type AnswerType } from '../data/subjects'
import { isFirebaseConfigured, getFirebaseDb } from './firebase'

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']
const ANSWER_TYPES: readonly AnswerType[] = ['graph', 'slider', 'fill']
const NUM_FIELDS = ['x', 'y', 'range', 'answer', 'min', 'max', 'step'] as const
const STR_FIELDS = ['fill', 'explain'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateQuestion(v: unknown): Question | null {
  if (!isRecord(v) || typeof v.prompt !== 'string') return null
  const q: Question = { prompt: v.prompt }
  for (const k of NUM_FIELDS) {
    const val = v[k]
    if (val === undefined) continue
    if (typeof val !== 'number' || !Number.isFinite(val)) return null
    q[k] = val
  }
  for (const k of STR_FIELDS) {
    const val = v[k]
    if (val === undefined) continue
    if (typeof val !== 'string') return null
    q[k] = val
  }
  return q
}

function validateSubunit(v: unknown): Subunit | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null
  const { difficulty, type } = v
  if (typeof difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(difficulty)) return null
  if (typeof type !== 'string' || !(ANSWER_TYPES as readonly string[]).includes(type)) return null
  if (!Array.isArray(v.questions)) return null
  const questions: Question[] = []
  for (const raw of v.questions) {
    const q = validateQuestion(raw)
    if (!q) return null
    questions.push(q)
  }
  return { id: v.id, name: v.name, difficulty: difficulty as Difficulty, type: type as AnswerType, questions }
}

function validateUnit(v: unknown): Unit | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.subunits)) return null
  const subunits: Subunit[] = []
  for (const raw of v.subunits) {
    const s = validateSubunit(raw)
    if (!s) return null
    subunits.push(s)
  }
  return { id: v.id, name: v.name, subunits }
}

/**
 * Narrows untrusted Firestore data to a Course, or null if malformed. Rebuilds
 * the object from known fields only, so doc extras (updatedAt, updatedBy) and
 * anything unexpected never leak into game state.
 */
export function validateCourse(data: unknown): Course | null {
  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.name !== 'string' || !Array.isArray(data.units)) return null
  const units: Unit[] = []
  for (const raw of data.units) {
    const u = validateUnit(raw)
    if (!u) return null
    units.push(u)
  }
  return { id: data.id, name: data.name, units }
}

/**
 * Pre-save completeness check for the admin editor: the shape may be a valid
 * Course while cleared inputs leave holes gameplay can't run on. Returns the
 * first problem as a human-pointable message, or null when publishable.
 */
export function draftIssue(course: Course): string | null {
  for (const u of course.units) {
    for (const s of u.subunits) {
      for (let i = 0; i < s.questions.length; i++) {
        const q = s.questions[i]
        const at = `${u.name} / ${s.name} — Q${i + 1}`
        if (q.prompt.trim() === '') return `${at}: prompt is empty.`
        if (s.type === 'graph' && (q.x === undefined || q.y === undefined)) return `${at}: graph answer needs both x and y.`
        if (s.type === 'slider') {
          if (q.answer === undefined || q.min === undefined || q.max === undefined) return `${at}: slider needs answer, min, and max.`
          if (q.min >= q.max) return `${at}: min must be less than max.`
          if (q.step !== undefined && q.step <= 0) return `${at}: step must be positive.`
        }
        if (s.type === 'fill' && (q.fill === undefined || q.fill.trim() === '')) return `${at}: fill answer is empty.`
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Firestore boundary
// ---------------------------------------------------------------------------

const COLLECTION = 'arcadeContent'

async function firestore() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

export type RemoteCourse =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'ok'; course: Course }

/**
 * Fetches and validates arcadeContent/{courseId}. Distinguishes a missing doc
 * from a malformed one (the admin editor offers seeding for the former).
 * Network/permission errors propagate to the caller.
 */
export async function fetchRemoteCourse(courseId: string): Promise<RemoteCourse> {
  const { sdk, db } = await firestore()
  const snap = await sdk.getDoc(sdk.doc(db, COLLECTION, courseId))
  if (!snap.exists()) return { status: 'missing' }
  const course = validateCourse(snap.data())
  return course ? { status: 'ok', course } : { status: 'invalid' }
}

/**
 * The game-facing loader: remote course when configured and valid, bundled
 * COURSES entry otherwise. Never rejects for content/network reasons — the
 * bundled fallback keeps gameplay identical to the pre-Firestore build.
 */
export async function loadCourse(courseId: string): Promise<Course> {
  const bundled = getCourse(courseId)
  if (!bundled) throw new Error(`Unknown course id: ${courseId}`) // programmer error, not a content failure
  if (!isFirebaseConfigured) return bundled
  try {
    const remote = await fetchRemoteCourse(courseId)
    if (remote.status === 'ok') return remote.course
    if (remote.status === 'invalid') {
      console.warn(`[eclipse-arcade] ${COLLECTION}/${courseId} is malformed — using the bundled course`)
    }
    return bundled
  } catch (err) {
    console.warn(`[eclipse-arcade] failed to load ${COLLECTION}/${courseId} — using the bundled course:`, err)
    return bundled
  }
}

/**
 * Admin write: replaces the whole course doc, stamping updatedAt (server time)
 * and updatedBy. Errors propagate — the editor surfaces them, never swallows.
 */
export async function saveCourse(course: Course, email: string): Promise<void> {
  const { sdk, db } = await firestore()
  // JSON round-trip strips `undefined` fields (Firestore rejects them) and
  // detaches the payload from live React state.
  const data = JSON.parse(JSON.stringify(course)) as Course
  await sdk.setDoc(sdk.doc(db, COLLECTION, course.id), {
    ...data,
    updatedAt: sdk.serverTimestamp(),
    updatedBy: email,
  })
}
