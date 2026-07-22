import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Smoke test for unconfigured mode: with the VITE_FIREBASE_* vars stubbed to
// '', the full provider tree must render today's lobby — decorative profile
// button, no sign-in affordances, no crash from the Firebase boundary.
// isFirebaseConfigured is computed when lib/firebase first evaluates, so the
// app modules are imported dynamically after stubbing (and after resetModules,
// which only resets source modules — react/react-router stay singletons). This
// keeps the test hermetic whether or not a real .env.local is present.
const FIREBASE_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

beforeAll(() => {
  const store = new Map<string, string>()
  const stub: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true })

  // renderToString of a client-only app makes react-router warn that
  // useLayoutEffect is a no-op on the server. That is harness noise, not a
  // product issue — silence exactly that message and let everything else through.
  const realError = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return
    realError(...args)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Lobby without Firebase config', () => {
  it('renders the arcade lobby with no sign-in UI', async () => {
    vi.resetModules()
    for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
    const [{ AuthProvider }, { PlayerProvider }, { default: Lobby }] = await Promise.all([
      import('../lib/auth'),
      import('../lib/player'),
      import('./Lobby'),
    ])
    const html = renderToString(
      <MemoryRouter>
        <AuthProvider>
          <PlayerProvider>
            <Lobby />
          </PlayerProvider>
        </AuthProvider>
      </MemoryRouter>
    )
    expect(html).toContain('ECLIPSE')
    expect(html).toContain('SELECT A GAME')
    // AccountControl is the only source of these labels — absent when unconfigured.
    expect(html).not.toContain('aria-label="Sign in"')
    expect(html).not.toContain('aria-label="Account menu"')
  })
})
