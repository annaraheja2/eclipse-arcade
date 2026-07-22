import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { validateUsername, isUsernameAvailable, claimUsername } from '../lib/username'

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error'
const DEBOUNCE_MS = 400

// A small modal for choosing/changing a username: live, debounced availability
// as you type, inline validation, and SAVE that claims the handle via the
// server transaction (claimUsername). Reused by the account popover and the
// non-blocking "choose a username" prompt.
export default function UsernamePicker({ uid, email, current, onClose, onSaved }: {
  uid: string
  email: string
  current?: string
  onClose: () => void
  onSaved: (username: string) => void
}) {
  const [value, setValue] = useState(current ?? '')
  const [avail, setAvail] = useState<Availability>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const check = validateUsername(value)
  const isCurrent = !!current && check.ok && check.lower === current.trim().toLowerCase()

  // Debounced availability check for a valid, changed handle.
  useEffect(() => {
    const v = validateUsername(value)
    if (!v.ok) { setAvail('idle'); return }
    // Your own current handle is trivially yours — no lookup needed.
    if (current && v.lower === current.trim().toLowerCase()) { setAvail('available'); return }
    setAvail('checking')
    let cancelled = false
    const id = window.setTimeout(() => {
      isUsernameAvailable(v.lower)
        .then((ok) => { if (!cancelled) setAvail(ok ? 'available' : 'taken') })
        .catch((err: unknown) => {
          if (cancelled) return
          console.error('[eclipse-arcade] availability check failed:', err)
          setAvail('error')
        })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [value, current])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>('input, button'))
      .filter((el) => !el.hasAttribute('disabled'))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const v = validateUsername(value)
    if (!v.ok) { setError(v.reason); return }
    setBusy(true)
    setError('')
    const res = await claimUsername(uid, email, value)
    setBusy(false)
    if (res.ok) onSaved(res.username)
    else setError(res.message)
  }

  // Saving your current handle is a no-op the transaction would still round-trip,
  // so gate it out entirely — the inline "current username" hint already explains why.
  const canSave = !busy && check.ok && avail !== 'taken' && !isCurrent

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center p-4 bg-black/70"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="username-title"
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl border-2 border-white/15 bg-[#120a2c] p-6 shadow-[inset_0_2px_0_rgba(255,255,255,0.08),0_0_40px_rgba(162,75,255,0.35),0_24px_60px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="username-title" className="font-pixel text-[12px] tracking-wider text-neon-cyan neon-text pt-1">
            {current ? 'CHANGE USERNAME' : 'CHOOSE A USERNAME'}
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

        <p className="mt-3 text-xs text-white/70">
          This is the name friends and opponents see instead of your email.
        </p>

        <form onSubmit={(e) => void save(e)} className="mt-4 space-y-3">
          <div>
            <label htmlFor="username-input" className="block font-pixel text-[8px] tracking-wider text-white/80 mb-2">
              USERNAME
            </label>
            <input
              id="username-input"
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={20}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError('') }}
              aria-describedby="username-help"
              className="w-full rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white placeholder:text-white/40"
              placeholder="AceRunner"
            />
            <p id="username-help" className="mt-2 text-xs text-white/60">
              3–20 characters · letters, numbers, underscore · starts with a letter.
            </p>
            <p className="mt-1.5 min-h-[1.25rem] text-xs" aria-live="polite">
              {value.trim() !== '' && !check.ok && <span className="text-[#ff9dbd]">{check.reason}</span>}
              {check.ok && !isCurrent && avail === 'checking' && <span className="text-white/60">Checking availability…</span>}
              {check.ok && !isCurrent && avail === 'available' && <span className="text-neon-green">Available</span>}
              {check.ok && !isCurrent && avail === 'taken' && <span className="text-[#ff9dbd]">That username is taken — try another.</span>}
              {check.ok && !isCurrent && avail === 'error' && <span className="text-[#ffc46b]">Couldn't check availability — you can still try to save.</span>}
              {isCurrent && <span className="text-white/60">This is your current username.</span>}
            </p>
          </div>

          {error && <p role="alert" className="text-sm text-[#ff9dbd]">{error}</p>}

          <button
            type="submit"
            disabled={!canSave}
            className="arcade-btn w-full font-pixel text-[10px] px-4 py-3 rounded-lg text-[#0a0620] disabled:opacity-60"
            style={btnVars('#3df5ff')}
          >
            {busy ? 'SAVING…' : 'SAVE'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  )
}

type BtnVars = CSSProperties & { '--btn': string; '--edge': string; '--glow': string }
function btnVars(color: string): BtnVars {
  return {
    '--btn': color,
    '--edge': `color-mix(in srgb, ${color} 50%, #000)`,
    '--glow': `${color}88`,
  }
}
