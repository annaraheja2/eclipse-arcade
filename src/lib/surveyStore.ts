// Reading and writing the onboarding survey.
//
// One document per player, keyed by uid. A player may read and write only their
// own; arcade admins may read them all, which is what the admin screen runs on.
//
// It lives in its own collection rather than on the player document because the
// two have nothing to do with each other: the player doc is written on every
// game and is on the hot path, while a survey is written once and read almost
// never. Keeping them apart also means the survey can't be lost to a
// player-state migration.
import { getFirebaseDb, isFirebaseConfigured } from './firebase'
import { toSurvey, surveyData, type Survey, type SurveyRow } from './survey'

const COLL = 'surveys'

async function fs() {
  const [sdk, db] = await Promise.all([import('firebase/firestore'), getFirebaseDb()])
  return { sdk, db }
}

export const surveysAvailable = (): boolean => isFirebaseConfigured

/** Records a response, or a skip. Overwrites, so answering twice is harmless. */
export async function saveSurvey(uid: string, survey: Survey): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.setDoc(sdk.doc(db, COLL, uid), {
    ...surveyData(survey),
    createdAt: sdk.serverTimestamp(),
  })
}

/** My own response, or null if I never gave one. */
export async function loadMySurvey(uid: string): Promise<SurveyRow | null> {
  const { sdk, db } = await fs()
  const snap = await sdk.getDoc(sdk.doc(db, COLL, uid))
  return snap.exists() ? toSurvey(uid, snap.data()) : null
}

/** Every response, for the admin screen. Denied unless you are an admin. */
export async function loadAllSurveys(): Promise<SurveyRow[]> {
  const { sdk, db } = await fs()
  const snap = await sdk.getDocs(sdk.collection(db, COLL))
  const rows: SurveyRow[] = []
  for (const d of snap.docs) {
    const row = toSurvey(d.id, d.data())
    if (row) rows.push(row)
  }
  // Newest first; a response with no server timestamp yet sorts last rather
  // than jumping to the top.
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return rows
}

/** Part of account deletion — the player's own row goes with them. */
export async function deleteMySurvey(uid: string): Promise<void> {
  const { sdk, db } = await fs()
  await sdk.deleteDoc(sdk.doc(db, COLL, uid))
}
