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
  resetPassword: (email: string) => Promise<AuthResult>
  resendVerification: () => Promise<AuthResult>
  // Links an email/password credential to the CURRENT (Google) account so the
  // user can afterward sign in with email + password on the same account.
  linkPassword: (password: string) => Promise<AuthResult>
  // Permanently deletes the auth user. `password` is used to re-authenticate a
  // password account when Firebase demands a recent login; Google accounts
  // re-auth via popup. Firestore fan-out (lib/account.ts) happens FIRST.
  deleteAccount: (password?: string) => Promise<AuthResult>
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
  'auth/requires-recent-login': 'For your security, please re-authenticate and try again.',
  'auth/provider-already-linked': 'This account already has a password set.',
  'auth/credential-already-in-use': 'That password credential is already tied to another account.',
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
  // Sends a password-reset email. Typed AuthResult with friendly errors.
  const resetPassword = useCallback(
    (email: string): Promise<AuthResult> => {
      if (!isFirebaseConfigured) return Promise.resolve(NOT_CONFIGURED)
      return (async (): Promise<AuthResult> => {
        try {
          const { sdk, auth } = await authSdk()
          await sdk.sendPasswordResetEmail(auth, email)
          return { status: 'ok' }
        } catch (err) {
          // ACCOUNT-ENUMERATION GUARD: an unknown address returns the SAME
          // neutral success as a real send, so an attacker can't probe which
          // emails have accounts. (Firebase's newer email-enumeration
          // protection already masks this, but we don't rely on that project
          // setting.) auth/invalid-email and unexpected errors still surface via
          // toResult — never swallowed.
          if (firebaseCode(err) === 'auth/user-not-found') return { status: 'ok' }
          return toResult(err)
        }
      })()
    },
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
  // GOOGLE-ONLY ACCOUNTS: sets a password by LINKING an email/password
  // credential to the signed-in Google account. If Firebase demands a recent
  // login, re-authenticate via a fresh Google popup and retry once. Afterward
  // the user can sign in with either provider on the same account.
  const linkPassword = useCallback(
    (password: string) => attempt(async () => {
      const { sdk, auth } = await authSdk()
      const u = auth.currentUser
      if (!u || !u.email) throw new Error('You must be signed in with an email to set a password.')
      const cred = sdk.EmailAuthProvider.credential(u.email, password)
      try {
        await sdk.linkWithCredential(u, cred)
      } catch (err) {
        if (firebaseCode(err) !== 'auth/requires-recent-login') throw err
        await sdk.reauthenticateWithPopup(u, new sdk.GoogleAuthProvider())
        await sdk.linkWithCredential(u, cred)
      }
    }),
    []
  )

  // Deletes the auth user. On auth/requires-recent-login, re-authenticate first
  // (Google popup, or an email/password credential from the supplied password)
  // then retry deleteUser. The caller runs the Firestore fan-out BEFORE this so
  // a still-present auth user can retry a partial cleanup idempotently.
  const deleteAccount = useCallback(
    (password?: string) => attempt(async () => {
      const { sdk, auth } = await authSdk()
      const u = auth.currentUser
      if (!u) throw new Error('You must be signed in to delete your account.')
      try {
        await sdk.deleteUser(u)
      } catch (err) {
        if (firebaseCode(err) !== 'auth/requires-recent-login') throw err
        const isGoogle = u.providerData.some((p) => p.providerId === 'google.com')
        if (isGoogle) {
          await sdk.reauthenticateWithPopup(u, new sdk.GoogleAuthProvider())
        } else if (password && u.email) {
          const cred = sdk.EmailAuthProvider.credential(u.email, password)
          await sdk.reauthenticateWithCredential(u, cred)
        } else {
          throw new Error('Re-enter your account password to confirm deletion, then try again.')
        }
        await sdk.deleteUser(u)
      }
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
      signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, resendVerification,
      linkPassword, deleteAccount, signOut,
    }),
    [user, loading, isAdmin, emailVerified, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, resendVerification, linkPassword, deleteAccount, signOut]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
