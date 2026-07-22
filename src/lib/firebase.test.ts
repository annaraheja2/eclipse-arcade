import { describe, it, expect, afterEach, vi } from 'vitest'

// Pins the unconfigured contract: importing is harmless, the flag is false, and
// the accessors fail loudly instead of half-initializing. isFirebaseConfigured
// is computed at module load from import.meta.env, so each test stubs the vars
// to '' and re-imports the module fresh — the suite stays hermetic whether or
// not a real .env.local is present.
const FIREBASE_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

function importUnconfigured() {
  vi.resetModules()
  for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
  return import('./firebase')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('firebase unconfigured mode', () => {
  it('reports unconfigured when env vars are absent', async () => {
    const { isFirebaseConfigured } = await importUnconfigured()
    expect(isFirebaseConfigured).toBe(false)
  })

  it('auth accessor rejects with a clear error instead of initializing', async () => {
    const { getFirebaseAuth } = await importUnconfigured()
    await expect(getFirebaseAuth()).rejects.toThrow(/not configured/)
  })

  it('firestore accessor rejects with a clear error instead of initializing', async () => {
    const { getFirebaseDb } = await importUnconfigured()
    await expect(getFirebaseDb()).rejects.toThrow(/not configured/)
  })
})
