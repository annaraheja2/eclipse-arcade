import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Static render smoke test (same unconfigured-Firebase harness as Racer/Lobby):
// the Practice landing (course picker) must render inside the full provider tree
// without crashing. The deeper flow — unit -> subtopics -> answering, which needs
// the async loadCourse — is driven in the browser for manual verification; the
// pure queue/pool logic behind it is covered in lib/practice.test.ts.
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

  const realError = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return
    realError(...args)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Practice without Firebase config', () => {
  it('renders the course picker without crashing', async () => {
    vi.resetModules()
    for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
    const [{ AuthProvider }, { PlayerProvider }, { default: Practice }] = await Promise.all([
      import('../lib/auth'),
      import('../lib/player'),
      import('./Practice'),
    ])
    const html = renderToString(
      <MemoryRouter>
        <AuthProvider>
          <PlayerProvider>
            <Practice />
          </PlayerProvider>
        </AuthProvider>
      </MemoryRouter>
    )
    expect(html).toContain('PRACTICE')
    expect(html).toContain('CHOOSE A COURSE')
    expect(html).toContain('Algebra 1')
    expect(html).toContain('Precalculus')
  })
})
