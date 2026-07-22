import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { isFirebaseConfigured, getFirebaseAuth } from './firebase'
import { isAdminEmail } from './admin'

// Every auth call resolves to one of these — no silent failures, and closing
// the Google popup is a benign cancel, not an error to show the user.
export type AuthResult =
  | { status: 'ok' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

interface AuthCtx {
  user: User | null
  loading: boolean
  isAdmin: boolean
  signInWithGoogle: () => Promise<AuthResult>
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<AuthResult>
}

const Ctx = createContext<AuthCtx | null>(null)

// Friendly copy for the Firebase error codes users can actually hit.
const FRIENDLY: Record<string, string> = {
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with that email already exists — sign in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts — wait a moment and try again.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup — allow popups and try again.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
}

const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

// FirebaseError carries a string `code`; duck-typed so this module never has to
// statically import firebase/app (which would defeat the lazy SDK loading).
function firebaseCode(err: unknown): string | null {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') return err.code
  return null
}

function toResult(err: unknown): AuthResult {
  const code = firebaseCode(err)
  if (code !== null) {
    if (CANCELLED_CODES.has(code)) return { status: 'cancelled' }
    return { status: 'error', message: FRIENDLY[code] ?? `Sign-in failed (${code}).` }
  }
  return { status: 'error', message: err instanceof Error ? err.message : 'Sign-in failed.' }
}

const NOT_CONFIGURED: AuthResult = {
  status: 'error',
  message: 'Firebase is not configured — accounts are unavailable.',
}

// Loads the auth SDK and the initialized Auth instance together; every method
// below runs through here, so the SDK is only ever fetched when configured.
async function authSdk() {
  const [sdk, auth] = await Promise.all([import('firebase/auth'), getFirebaseAuth()])
  return { sdk, auth }
}

async function attempt(action: () => Promise<unknown>): Promise<AuthResult> {
  if (!isFirebaseConfigured) return NOT_CONFIGURED
  try {
    await action()
    return { status: 'ok' }
  } catch (err) {
    return toResult(err)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // Unconfigured: there is no auth state to wait for — render as signed out immediately.
  const [loading, setLoading] = useState(isFirebaseConfigured)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    authSdk()
      .then(({ sdk, auth }) => {
        if (cancelled) return
        unsubscribe = sdk.onAuthStateChanged(auth, (u) => {
          setUser(u)
          setLoading(false)
        })
      })
      .catch((err: unknown) => {
        console.error('[eclipse-arcade] auth init failed:', err)
        setLoading(false)
      })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const signInWithGoogle = useCallback(
    () => attempt(async () => {
      const { sdk, auth } = await authSdk()
      await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider())
    }),
    []
  )
  const signInWithEmail = useCallback(
    (email: string, password: string) => attempt(async () => {
      const { sdk, auth } = await authSdk()
      await sdk.signInWithEmailAndPassword(auth, email, password)
    }),
    []
  )
  const signUpWithEmail = useCallback(
    (email: string, password: string) => attempt(async () => {
      const { sdk, auth } = await authSdk()
      await sdk.createUserWithEmailAndPassword(auth, email, password)
    }),
    []
  )
  const signOut = useCallback(
    () => attempt(async () => {
      const { sdk, auth } = await authSdk()
      await sdk.signOut(auth)
    }),
    []
  )

  // Mirrors the firestore.rules isAdmin() condition: verified email in the admin
  // list. UI gating only — the rules are the enforcement (see lib/admin.ts).
  //
  // NOTE: admin access is effectively GOOGLE-SIGN-IN-ONLY for now. Google
  // accounts arrive with emailVerified === true, but signUpWithEmail never
  // sends a verification email, so an email/password account can never pass
  // this check (or the matching rules condition). That is accepted for this
  // phase — do NOT "fix" it by dropping the emailVerified requirement; the
  // right fix, when needed, is sending the verification email on sign-up.
  const isAdmin = user !== null && user.emailVerified && isAdminEmail(user.email ?? '')

  const value = useMemo(
    () => ({ user, loading, isAdmin, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }),
    [user, loading, isAdmin, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
