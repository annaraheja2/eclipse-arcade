import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Static render smoke test (same unconfigured-Firebase harness as Lobby.test):
// the vs-AI opponent screen must render inside the full provider tree without
// crashing. Drives the new COURSE_LIST import and the course-picker phase code
// paths at compile+render time; live click-through of course->unit->subunit is
// noted for manual verification.
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

describe('Battleship without Firebase config', () => {
  it('renders the vs-AI opponent screen without crashing', async () => {
    vi.resetModules()
    for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
    const [{ AuthProvider }, { PlayerProvider }, { default: Battleship }] = await Promise.all([
      import('../lib/auth'),
      import('../lib/player'),
      import('./Battleship'),
    ])
    const html = renderToString(
      <MemoryRouter>
        <AuthProvider>
          <PlayerProvider>
            <Battleship />
          </PlayerProvider>
        </AuthProvider>
      </MemoryRouter>
    )
    expect(html).toContain('CHOOSE YOUR OPPONENT')
    expect(html).toContain('VS AI')
  })
})
