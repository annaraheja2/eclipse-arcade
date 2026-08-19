import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Static render smoke test, same harness as the other online pages. A build
// without VITE_FIREBASE_* serves this path, and it must explain itself rather
// than crash.
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

describe('Card Game table without Firebase config', () => {
  it('explains that online play is unavailable instead of crashing', async () => {
    vi.resetModules()
    for (const name of FIREBASE_ENV) vi.stubEnv(name, '')
    const [{ AuthProvider }, { PlayerProvider }, { default: CardGameOnline }] = await Promise.all([
      import('../lib/auth'),
      import('../lib/player'),
      import('./CardGameOnline'),
    ])
    const html = renderToString(
      <MemoryRouter initialEntries={['/cardgame/room/abc123']}>
        <AuthProvider>
          <PlayerProvider>
            <Routes>
              <Route path="/cardgame/room/:roomId" element={<CardGameOnline />} />
            </Routes>
          </PlayerProvider>
        </AuthProvider>
      </MemoryRouter>
    )
    expect(html).toContain('CARD GAME')
    // Apostrophes render HTML-escaped, so match on plain words.
    expect(html).toContain('cloud setup')
  })
})
