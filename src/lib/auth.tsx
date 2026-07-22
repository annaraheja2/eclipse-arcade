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

// ONLINE-SOCIAL REQUIRES A VERIFIED EMAIL (mirrors the admin gap documented
// below and the verified() gate in firestore.rules / lib/social.ts): every
// social surface — friend requests, matchmaking, PvP match creation — demands
// request.auth.token.email_verified == true, so an attacker can't claim a
// victim's address before proving ownership. Google sign-in is auto-verified;
// email/password accounts land UNVERIFIED and MUST verify first (we send the
// link on sign-up, and resendVerification() re-sends it). `emailVerified` is a
// first-class UI state: signed-in-but-unverified users get gated OUT of the
// online entry points instead of clicking into a permission-denied flow.
interface AuthCtx {
  user: User | null
  loading: boolean
  isAdmin: boolean
  emailVerified: boolean
  signInWithGoogle: () => Promise<AuthResult>
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>
  resendVerification: () => Promise<AuthResult>
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
      const cred = await sdk.createUserWithEmailAndPassword(auth, email, password)
      // Email/password accounts start UNVERIFIED, and online-social rules
      // require a verified email (see the AuthCtx note above) — send the
      // verification link now. A send failure must NOT fail the whole sign-up:
      // the account exists and the user is already signed in, and they can
      // retry via resendVerification(). Log it so it's never silently lost.
      try {
        await sdk.sendEmailVerification(cred.user)
      } catch (err) {
        console.error('[eclipse-arcade] verification email send failed on sign-up:', err)
      }
    }),
    []
  )
  // Re-sends the verification link to the currently signed-in user. Typed
  // AuthResult with friendly errors — never swallowed.
  const resendVerification = useCallback(
    () => attempt(async () => {
      const { sdk, auth } = await authSdk()
      if (!auth.currentUser) throw new Error('You must be signed in to resend a verification email.')
      await sdk.sendEmailVerification(auth.currentUser)
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
  // The emailVerified requirement stands (an unverified signup could otherwise
  // just CLAIM an admin address): Google accounts are auto-verified, and an
  // email/password admin now qualifies only AFTER clicking the verification
  // link we send on sign-up. Do NOT drop the emailVerified requirement.
  const isAdmin = user !== null && user.emailVerified && isAdminEmail(user.email ?? '')

  // Signed-in-but-unverified is a distinct, first-class state (see AuthCtx
  // note): the online-social entry points gate on this, not just on `user`.
  const emailVerified = user !== null && user.emailVerified

  const value = useMemo(
    () => ({
      user, loading, isAdmin, emailVerified,
      signInWithGoogle, signInWithEmail, signUpWithEmail, resendVerification, signOut,
    }),
    [user, loading, isAdmin, emailVerified, signInWithGoogle, signInWithEmail, signUpWithEmail, resendVerification, signOut]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
