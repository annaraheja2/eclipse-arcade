import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { User as UserIcon } from '../icons'

// The HUD account button, rendered only when Firebase is configured (the Lobby
// keeps its decorative button otherwise). Signed out it opens the sign-in
// modal; signed in it opens a small account popover with sign-out.
export default function AccountControl() {
  const { user, loading } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeModal = () => {
    setModalOpen(false)
    triggerRef.current?.focus()
  }

  if (user) {
    const initial = (user.email ?? '?').charAt(0).toUpperCase()
    return (
      <div className="relative">
        <button
          ref={triggerRef}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Account menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-blue text-[#06121a] shadow-[0_0_16px_rgba(61,245,255,0.6)] font-pixel text-sm"
        >
          {initial}
        </button>
        {menuOpen && (
          <AccountMenu
            onClose={(restoreFocus = true) => {
              setMenuOpen(false)
              if (restoreFocus) triggerRef.current?.focus()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setModalOpen(true)}
        disabled={loading}
        aria-label="Sign in"
        aria-haspopup="dialog"
        className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-blue text-[#06121a] shadow-[0_0_16px_rgba(61,245,255,0.6)] disabled:opacity-60"
      >
        <UserIcon width={18} height={18} />
      </button>
      {modalOpen && <SignInModal onClose={closeModal} />}
    </>
  )
}

// onClose(false) skips restoring focus to the trigger — used when the popover
// closes because focus already moved somewhere else (tab-out).
function AccountMenu({ onClose }: { onClose: (restoreFocus?: boolean) => void }) {
  const { user, isAdmin, signOut } = useAuth()
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.querySelector('button')?.focus()
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    // Deferred so the opening click doesn't immediately close the popover.
    const id = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDocClick) }
  }, [onClose])

  const handleSignOut = async () => {
    const res = await signOut()
    if (res.status === 'error') setError(res.message)
    else onClose()
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Account"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      onBlur={(e) => {
        // Tabbing out dismisses the popover, leaving focus where the user sent
        // it. relatedTarget is null on outside clicks / window blur — the
        // document mousedown listener owns that case.
        const to = e.relatedTarget as Node | null
        if (to && !e.currentTarget.contains(to)) onClose(false)
      }}
      className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-white/15 bg-[#120a2c] p-4 shadow-[0_0_24px_rgba(61,245,255,0.25),0_16px_40px_-12px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-white/90 truncate" title={user?.email ?? undefined}>
          {user?.email}
        </span>
        {isAdmin && (
          <Link
            to="/admin"
            onClick={() => onClose(false)}
            className="shrink-0 font-pixel text-[8px] px-1.5 py-1 rounded bg-neon-amber text-[#2a1a00] hover:brightness-110"
          >
            ADMIN
          </Link>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[#ff9dbd]">{error}</p>}
      <button
        onClick={handleSignOut}
        className="arcade-btn mt-3.5 w-full font-pixel text-[10px] px-4 py-2.5 rounded-lg text-[#0a0620]"
        style={btnVars('#3df5ff')}
      >
        SIGN OUT
      </button>
    </div>
  )
}

type Mode = 'signin' | 'signup'

function SignInModal({ onClose }: { onClose: () => void }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const googleBtnRef = useRef<HTMLButtonElement>(null)

  // Initial focus lands on the primary action (Google sign-in), not the Close
  // button that happens to come first in DOM order.
  useEffect(() => {
    googleBtnRef.current?.focus()
  }, [])

  // Keyboard: Esc closes; Tab is trapped inside the dialog.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('input, button')
    ).filter((el) => !el.hasAttribute('disabled'))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const runAuth = async (action: () => ReturnType<typeof signInWithGoogle>) => {
    setError('')
    setBusy(true)
    const res = await action()
    setBusy(false)
    if (res.status === 'ok') onClose()
    else if (res.status === 'error') setError(res.message)
    // 'cancelled' (popup closed) is benign: keep the modal open, no error.
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const authFn = mode === 'signin' ? signInWithEmail : signUpWithEmail
    void runAuth(() => authFn(email, password))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center p-4 bg-black/70"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl border-2 border-white/15 bg-[#120a2c] p-6 shadow-[inset_0_2px_0_rgba(255,255,255,0.08),0_0_40px_rgba(162,75,255,0.35),0_24px_60px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="signin-title" className="font-pixel text-[12px] tracking-wider text-neon-cyan neon-text pt-1">
            {mode === 'signin' ? 'PLAYER SIGN-IN' : 'NEW PLAYER'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
              <path d="M5 5l14 14M19 5 5 19" />
            </svg>
          </button>
        </div>

        <button
          ref={googleBtnRef}
          onClick={() => void runAuth(signInWithGoogle)}
          disabled={busy}
          className="arcade-btn mt-5 w-full font-pixel text-[10px] px-4 py-3 rounded-lg text-[#0a0620] disabled:opacity-60"
          style={btnVars('#3df5ff')}
        >
          SIGN IN WITH GOOGLE
        </button>

        <div className="my-5 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-white/15" />
          <span className="font-pixel text-[8px] text-white/60">OR</span>
          <span className="h-px flex-1 bg-white/15" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="EMAIL" id="auth-email">
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white placeholder:text-white/40"
              placeholder="player@example.com"
            />
          </Field>
          <Field label="PASSWORD" id="auth-password">
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white"
            />
          </Field>
          {error && <p role="alert" className="text-sm text-[#ff9dbd]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="arcade-btn w-full font-pixel text-[10px] px-4 py-3 rounded-lg text-[#0a0620] disabled:opacity-60"
            style={btnVars('#ff3df0')}
          >
            {mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}
          className="mt-4 w-full text-center text-sm text-white/80 hover:text-white underline underline-offset-4"
        >
          {mode === 'signin' ? 'New player? Create an account' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>,
    document.body
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block font-pixel text-[8px] tracking-wider text-white/80 mb-2">
        {label}
      </label>
      {children}
    </div>
  )
}

// Same accent-var pattern as the lobby's arcadeBtnStyle (see Lobby.tsx).
type BtnVars = CSSProperties & { '--btn': string; '--edge': string; '--glow': string }
function btnVars(color: string): BtnVars {
  return {
    '--btn': color,
    '--edge': `color-mix(in srgb, ${color} 50%, #000)`,
    '--glow': `${color}88`,
  }
}
