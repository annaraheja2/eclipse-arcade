import { useState, type CSSProperties } from 'react'
import { useAuth } from '../lib/auth'

// Shown to a signed-in email/password user whose address isn't verified yet.
// Online-social Firestore rules require a verified email (see lib/social.ts and
// the AuthCtx note in lib/auth.tsx), so we surface this — with a resend button —
// instead of letting them click into a permission-denied flow. Google accounts
// are always verified and never render this.
const CY = '#3df5ff'
const CY_BTN: CSSProperties & { '--btn': string; '--edge': string; '--glow': string } = {
  '--btn': CY, '--edge': `color-mix(in srgb, ${CY} 50%, #000)`, '--glow': `${CY}88`,
}

export default function VerifyEmailNotice({ message, className }: {
  message: string
  className?: string
}) {
  const { resendVerification } = useAuth()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function resend() {
    setBusy(true)
    setError('')
    setSent(false)
    const res = await resendVerification()
    setBusy(false)
    if (res.status === 'ok') setSent(true)
    else if (res.status === 'error') setError(res.message)
    // 'cancelled' can't happen here (no popup) — nothing to do.
  }

  return (
    <div className={className}>
      <p className="text-sm text-white/80">{message}</p>
      <button
        onClick={() => void resend()}
        disabled={busy}
        className="arcade-btn mt-3 font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60"
        style={CY_BTN}
      >
        {busy ? 'SENDING…' : 'RESEND VERIFICATION'}
      </button>
      {sent && (
        <p role="status" className="mt-2.5 text-sm text-neon-green">
          Verification email sent — check your inbox, then reload this page.
        </p>
      )}
      {error && <p role="alert" className="mt-2.5 text-sm text-[#ff9dbd]">{error}</p>}
    </div>
  )
}
