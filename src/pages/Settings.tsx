import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  usePlayer, levelFromXp, isStreakAtRisk, todayStr, accuracy,
  resolveCourseId, AVATAR_COLORS,
} from '../lib/player'
import { isFirebaseConfigured } from '../lib/firebase'
import { COURSE_LIST } from '../data/subjects'
import { GAMES } from '../lib/games'
import { displayNameFor } from '../lib/username'
import { isMuted, setMuted } from '../lib/sound'
import { isReducedMotion, setReducedMotion } from '../lib/motion'
import { buildExportPayload, deleteAccountData } from '../lib/account'
import { subscribeFriendships, type Friendship } from '../lib/social'
import Avatar from '../components/Avatar'
import AccountControl from '../components/AccountControl'
import UsernamePicker from '../components/UsernamePicker'
import VerifyEmailNotice from '../components/VerifyEmailNotice'
import { ArrowLeft, Coin, Flame, Bolt } from '../icons'

const CY = '#3df5ff'
type BtnVars = CSSProperties & { '--btn': string; '--edge': string; '--glow': string }
function btnVars(color: string): BtnVars {
  return { '--btn': color, '--edge': `color-mix(in srgb, ${color} 50%, #000)`, '--glow': `${color}88` }
}
// Brighten an accent for text on the #0a0620 field so thin glyphs still clear AA.
const bright = (color: string) => `color-mix(in srgb, ${color} 72%, #fff)`

// Human-readable names aligned index-for-index with AVATAR_COLORS.
const AVATAR_COLOR_NAMES = ['cyan', 'magenta', 'purple', 'violet', 'pink', 'amber', 'green', 'blue']

export default function Settings() {
  const { user, loading } = useAuth()
  return (
    <div className="min-h-screen relative">
      <div className="pointer-events-none fixed inset-0 grid-floor" />
      <div className="relative max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" aria-label="Back to arcade" className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white">
            <ArrowLeft width={18} height={18} />
          </Link>
          <h1 className="font-pixel text-[12px]" style={{ color: CY }}>SETTINGS</h1>
          <div className="w-10 h-10 grid place-items-center">{isFirebaseConfigured && <AccountControl />}</div>
        </div>

        {!isFirebaseConfigured ? (
          <Gate title="ACCOUNTS OFFLINE">
            Firebase is not configured in this build, so there is no account to manage — player
            progress is saved locally in this browser only.
          </Gate>
        ) : loading ? (
          <p className="text-center text-white/70 font-pixel text-[10px] py-16">LOADING…</p>
        ) : !user ? (
          <Gate title="SIGN IN">
            Sign in to view your progress, pick your math level, and manage your account. Use the
            account button in the top-right to get started.
          </Gate>
        ) : (
          <SignedIn user={user} />
        )}
      </div>
    </div>
  )
}

function SignedIn({ user }: { user: User }) {
  const navigate = useNavigate()
  const { emailVerified, resetPassword, linkPassword, deleteAccount } = useAuth()
  const { player, setUsername, updatePreferences } = usePlayer()

  const [friendships, setFriendships] = useState<Friendship[]>([])
  useEffect(() => {
    return subscribeFriendships(
      user.uid, setFriendships,
      (err) => console.error('[eclipse-arcade] settings friends load failed:', err)
    )
  }, [user.uid])

  const preferredCourseId = resolveCourseId(player.preferredCourseId)
  const avatarColor = player.avatarColor ?? CY
  const email = (user.email ?? '').toLowerCase()

  // Provider-aware password controls (see the Password section).
  const hasPassword = user.providerData.some((p) => p.providerId === 'password')
  const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com')

  return (
    <div className="space-y-5 pb-16">
      <ProfileHeader player={player} email={user.email} avatarColor={avatarColor} />

      <ProgressCard player={player} />

      <MathLevelCard
        preferredCourseId={preferredCourseId}
        onPick={(id) => updatePreferences({ preferredCourseId: id })}
      />

      <AvatarCard
        avatarColor={avatarColor}
        onPick={(color) => updatePreferences({ avatarColor: color })}
      />

      <UsernameCard
        uid={user.uid} email={user.email} username={player.username}
        emailVerified={emailVerified} onSaved={setUsername}
      />

      <PasswordCard
        email={user.email} hasPassword={hasPassword} hasGoogle={hasGoogle}
        resetPassword={resetPassword} linkPassword={linkPassword}
      />

      <PreferencesCard />

      <DataPrivacyCard
        player={player} friendships={friendships} uid={user.uid} email={email}
        username={player.username} emailVerified={emailVerified} hasPassword={hasPassword}
        deleteAccount={deleteAccount}
        onDeleted={() => navigate('/')}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="font-pixel text-[10px] tracking-wider mb-4" style={{ color: bright(CY) }}>{title}</h2>
      {children}
    </section>
  )
}

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-md mx-auto text-center rounded-2xl border-2 border-white/15 bg-[#120a2c] px-6 py-10 mt-10">
      <h2 className="font-pixel text-[13px] tracking-wider neon-text mb-4" style={{ color: CY }}>{title}</h2>
      <p className="text-sm text-white/80 leading-relaxed">{children}</p>
    </div>
  )
}

// Accessible on/off switch: a real button with role="switch" — Enter/Space toggle it.
function Toggle({ checked, onChange, label, color = CY }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; color?: string
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full border transition-colors"
      style={{ background: checked ? color : 'rgba(255,255,255,0.14)', borderColor: checked ? color : 'rgba(255,255,255,0.45)' }}
    >
      <span
        className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(27px)' : 'translateX(3px)' }}
      />
    </button>
  )
}

type PlayerLike = ReturnType<typeof usePlayer>['player']

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ProfileHeader({ player, email, avatarColor }: {
  player: PlayerLike; email: string | null; avatarColor: string
}) {
  const name = displayNameFor(player.username, email)
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex items-center gap-4">
      <Avatar mood="happy" color={avatarColor} size={64} />
      <div className="min-w-0">
        <div className="font-pixel text-[12px] truncate" style={{ color: bright(avatarColor) }}>{name}</div>
        {email && <div className="text-xs text-white/60 truncate mt-1" title={email}>{email}</div>}
      </div>
    </section>
  )
}

function ProgressCard({ player }: { player: PlayerLike }) {
  const { level, into, pct } = levelFromXp(player.xp)
  const atRisk = isStreakAtRisk(player.lastPlayed, todayStr())
  const acc = accuracy(player.questionsAnswered, player.questionsCorrect)
  const bestGames = GAMES.filter((g) => g.type !== 'soon' && (player.bests[g.key] ?? 0) > 0)

  return (
    <Card title="PROGRESS">
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="flex items-center gap-1.5 font-pixel text-[9px] text-white/80">
            <Bolt width={13} height={13} className="text-neon-cyan" /> LEVEL {level}
          </span>
          <span className="tabular-nums text-white/60">{into} / 500 XP</span>
        </div>
        <span className="block w-full h-2 rounded-full bg-white/12 overflow-hidden">
          <span className="block h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-magenta" style={{ width: `${pct}%` }} />
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Credits" value={player.coins.toLocaleString()} icon={<Coin width={15} height={15} />} color="#ffb43d" />
        <Stat
          label="Streak"
          value={`${player.streak}${atRisk ? ' · at risk' : ''}`}
          icon={<Flame width={15} height={15} />}
          color={atRisk ? '#ff6b3d' : '#ffb43d'}
        />
        <Stat label="Games played" value={player.gamesPlayed.toLocaleString()} />
        <Stat label="Question accuracy" value={acc === null ? '—' : `${Math.round(acc * 100)}%`} />
      </div>

      <div className="mt-5">
        <div className="font-pixel text-[8px] tracking-wider text-white/60 mb-2">BEST SCORES</div>
        {bestGames.length === 0 ? (
          <p className="text-sm text-white/55">No scores yet — play a game to set a high score.</p>
        ) : (
          <ul className="grid gap-1.5">
            {bestGames.map((g) => (
              <li key={g.key} className="flex items-center justify-between text-sm">
                <span className="text-white/80">{g.name}</span>
                <span className="font-bold tabular-nums" style={{ color: bright(g.color) }}>
                  {(player.bests[g.key] ?? 0).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Stat({ label, value, icon, color }: { label: string; value: string; icon?: ReactNode; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] text-white/60">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 font-semibold tabular-nums" style={color ? { color: bright(color) } : undefined}>
        {icon}{value}
      </div>
    </div>
  )
}

function MathLevelCard({ preferredCourseId, onPick }: {
  preferredCourseId: string; onPick: (id: string) => void
}) {
  return (
    <Card title="MATH LEVEL">
      <p className="text-sm text-white/65 mb-4">Your default course for vs-AI Battleship. You can still change it per game.</p>
      <fieldset className="grid gap-2.5 sm:grid-cols-2 border-0 p-0 m-0 min-w-0" aria-label="Preferred math level">
        {COURSE_LIST.map((c) => {
          const selected = c.id === preferredCourseId
          return (
            <button
              key={c.id} type="button" aria-pressed={selected}
              onClick={() => onPick(c.id)}
              className={`text-left rounded-xl border p-3.5 transition ${selected ? 'border-neon-cyan/70 bg-neon-cyan/10' : 'border-white/10 bg-white/[0.02] hover:border-neon-cyan/40'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.name}</span>
                {selected && <span className="shrink-0 font-pixel text-[8px] px-2 py-1 rounded" style={{ background: `${CY}22`, color: bright(CY) }}>SELECTED</span>}
              </div>
            </button>
          )
        })}
      </fieldset>
    </Card>
  )
}

function AvatarCard({ avatarColor, onPick }: { avatarColor: string; onPick: (color: string) => void }) {
  return (
    <Card title="AVATAR COLOR">
      <div className="flex items-center gap-4">
        <Avatar mood="aim" color={avatarColor} size={56} />
        <fieldset className="flex flex-wrap gap-2.5 border-0 p-0 m-0 min-w-0" aria-label="Avatar color">
          {AVATAR_COLORS.map((color, i) => {
            const selected = color === avatarColor
            return (
              <button
                key={color} type="button" aria-pressed={selected}
                aria-label={AVATAR_COLOR_NAMES[i] ?? color}
                onClick={() => onPick(color)}
                className="w-8 h-8 rounded-full border-2 transition"
                style={{ background: color, borderColor: selected ? '#fff' : 'transparent', boxShadow: selected ? `0 0 12px ${color}` : 'none' }}
              />
            )
          })}
        </fieldset>
      </div>
    </Card>
  )
}

function UsernameCard({ uid, email, username, emailVerified, onSaved }: {
  uid: string; email: string | null; username?: string; emailVerified: boolean; onSaved: (u: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <Card title="USERNAME">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{username ?? 'No username set'}</div>
          {email && <div className="text-xs text-white/60 truncate mt-0.5" title={email}>{email}</div>}
        </div>
        <button
          type="button" onClick={() => setPickerOpen(true)}
          className="shrink-0 arcade-btn font-pixel text-[9px] px-4 py-2.5 rounded-lg text-[#0a0620]"
          style={btnVars(CY)}
        >
          {username ? 'CHANGE' : 'SET'}
        </button>
      </div>
      {!emailVerified && (
        <VerifyEmailNotice className="mt-4" message="Your email isn't verified yet — verify it to play online." />
      )}
      {pickerOpen && email && (
        <UsernamePicker
          uid={uid} email={email} current={username}
          onClose={() => setPickerOpen(false)}
          onSaved={(u) => { onSaved(u); setPickerOpen(false) }}
        />
      )}
    </Card>
  )
}

// PROVIDER-AWARE: a Google-only account (no 'password' provider) gets a
// "Set a password" LINK form so it can afterward sign in with email+password
// too. An email/password account gets a reset-email button instead.
function PasswordCard({ email, hasPassword, hasGoogle, resetPassword, linkPassword }: {
  email: string | null
  hasPassword: boolean
  hasGoogle: boolean
  resetPassword: (email: string) => ReturnType<ReturnType<typeof useAuth>['resetPassword']>
  linkPassword: (password: string) => ReturnType<ReturnType<typeof useAuth>['linkPassword']>
}) {
  if (!hasPassword) {
    return (
      <Card title="PASSWORD">
        <p className="text-sm text-white/65 mb-4">
          {hasGoogle ? 'You sign in with Google.' : 'Your account has no password yet.'} Set a
          password to also sign in with your email and password on this same account.
        </p>
        <SetPasswordForm linkPassword={linkPassword} />
      </Card>
    )
  }
  return (
    <Card title="PASSWORD">
      <p className="text-sm text-white/65 mb-4">
        We'll email a secure link to reset your password.
      </p>
      <SendResetButton email={email} resetPassword={resetPassword} />
    </Card>
  )
}

function SetPasswordForm({ linkPassword }: {
  linkPassword: (password: string) => ReturnType<ReturnType<typeof useAuth>['linkPassword']>
}) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (pw !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const res = await linkPassword(pw)
    setBusy(false)
    if (res.status === 'ok') { setDone(true); setPw(''); setConfirm('') }
    else if (res.status === 'error') setError(res.message)
    // 'cancelled' = closed the Google re-auth popup — leave the form as-is.
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-neon-green">
        Password set — you can now sign in with your email and this password too.
      </p>
    )
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <LabeledInput id="new-password" label="NEW PASSWORD" type="password" autoComplete="new-password"
        value={pw} onChange={setPw} minLength={6} />
      <LabeledInput id="confirm-password" label="CONFIRM PASSWORD" type="password" autoComplete="new-password"
        value={confirm} onChange={setConfirm} minLength={6} />
      {error && <p role="alert" className="text-sm text-[#ff9dbd]">{error}</p>}
      <button type="submit" disabled={busy}
        className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60"
        style={btnVars(CY)}>
        {busy ? 'SETTING…' : 'SET PASSWORD'}
      </button>
    </form>
  )
}

function SendResetButton({ email, resetPassword }: {
  email: string | null
  resetPassword: (email: string) => ReturnType<ReturnType<typeof useAuth>['resetPassword']>
}) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  async function send() {
    if (!email) return
    setBusy(true); setError(''); setSent(false)
    const res = await resetPassword(email)
    setBusy(false)
    if (res.status === 'ok') setSent(true)
    else if (res.status === 'error') setError(res.message)
  }
  return (
    <div>
      <button type="button" onClick={() => void send()} disabled={busy || !email}
        className="arcade-btn font-pixel text-[10px] px-5 py-2.5 rounded-lg text-[#0a0620] disabled:opacity-60"
        style={btnVars('#ff3df0')}>
        {busy ? 'SENDING…' : 'SEND RESET EMAIL'}
      </button>
      {sent && <p role="status" className="mt-3 text-sm text-neon-green">Reset link sent — check your inbox.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-[#ff9dbd]">{error}</p>}
    </div>
  )
}

function PreferencesCard() {
  const [muted, setMutedLocal] = useState(isMuted())
  const [reduced, setReducedLocal] = useState(isReducedMotion())
  return (
    <Card title="SOUND & MOTION">
      <div className="flex items-center justify-between py-1">
        <div>
          <div className="font-semibold">Sound effects</div>
          <div className="text-xs text-white/60 mt-0.5">Battle audio across the arcade.</div>
        </div>
        <Toggle
          label="Sound effects" checked={!muted}
          onChange={(on) => { setMuted(!on); setMutedLocal(!on) }}
        />
      </div>
      <div className="h-px bg-white/8 my-3" />
      <div className="flex items-center justify-between py-1">
        <div>
          <div className="font-semibold">Reduce motion</div>
          <div className="text-xs text-white/60 mt-0.5">Stills the arcade's decorative animations.</div>
        </div>
        <Toggle
          label="Reduce motion" checked={reduced} color="#a24bff"
          onChange={(on) => { setReducedMotion(on); setReducedLocal(on) }}
        />
      </div>
    </Card>
  )
}

function DataPrivacyCard({ player, friendships, uid, email, username, emailVerified, hasPassword, deleteAccount, onDeleted }: {
  player: PlayerLike
  friendships: Friendship[]
  uid: string
  email: string
  username?: string
  emailVerified: boolean
  hasPassword: boolean
  deleteAccount: (password?: string) => ReturnType<ReturnType<typeof useAuth>['deleteAccount']>
  onDeleted: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  function exportData() {
    const payload = buildExportPayload(player, friendships)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eclipse-arcade-${uid}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function confirmDelete() {
    setError('')
    setDeleting(true)
    // Data fan-out FIRST — never touch the auth user on a partial cleanup.
    const dataRes = await deleteAccountData(uid, email, username, { includeSocial: emailVerified })
    if (!dataRes.ok) {
      if (mounted.current) {
        setError(`Could not delete: ${dataRes.failed.join('; ')}. Your login was not removed — try again.`)
        setDeleting(false)
      }
      return
    }
    const authRes = await deleteAccount(hasPassword ? password : undefined)
    if (authRes.status === 'ok') { onDeleted(); return } // provider unmounts us via sign-out
    if (mounted.current) {
      setDeleting(false)
      if (authRes.status === 'cancelled') setError('Re-authentication was cancelled — your account was not deleted.')
      else setError(authRes.message)
    }
  }

  return (
    <Card title="DATA & PRIVACY">
      <button type="button" onClick={exportData}
        className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/85 hover:bg-white/10 transition">
        EXPORT MY DATA
      </button>
      <p className="text-xs text-white/55 mt-2">Downloads your progress and friendships as a JSON file.</p>

      <div className="h-px bg-white/8 my-4" />

      {!confirmOpen ? (
        <>
          <button type="button" onClick={() => { setConfirmOpen(true); setError('') }}
            className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-[#ff4d8d]/15 border border-[#ff4d8d]/50 text-[#ff9dbd] hover:bg-[#ff4d8d]/25 transition">
            DELETE MY ACCOUNT
          </button>
          <p className="text-xs text-white/55 mt-2">Permanently removes your account and all its data. This cannot be undone.</p>
        </>
      ) : (
        <div className="rounded-xl border border-[#ff4d8d]/40 bg-[#ff4d8d]/[0.06] p-4">
          <p className="text-sm text-white/85 mb-3">
            This permanently deletes your account, progress, username, and friendships. Type
            <span className="font-pixel text-[10px] text-[#ff9dbd]"> DELETE </span>
            to confirm.
          </p>
          <LabeledInput id="delete-confirm" label="CONFIRMATION" type="text" value={confirmText}
            onChange={setConfirmText} autoComplete="off" placeholder="DELETE" />
          {hasPassword && (
            <div className="mt-3">
              <LabeledInput id="delete-password" label="PASSWORD (TO CONFIRM)" type="password"
                autoComplete="current-password" value={password} onChange={setPassword} />
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-[#ff9dbd]">{error}</p>}
          <div className="mt-4 flex items-center gap-2.5">
            <button type="button" onClick={() => void confirmDelete()}
              disabled={deleting || confirmText !== 'DELETE' || (hasPassword && password.length < 6)}
              className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-[#ff4d8d] text-[#2a0512] disabled:opacity-50">
              {deleting ? 'DELETING…' : 'DELETE FOREVER'}
            </button>
            <button type="button" onClick={() => { setConfirmOpen(false); setConfirmText(''); setPassword(''); setError('') }}
              disabled={deleting}
              className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-60">
              CANCEL
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function LabeledInput({ id, label, type, value, onChange, autoComplete, minLength, placeholder }: {
  id: string; label: string; type: 'text' | 'password'; value: string
  onChange: (v: string) => void; autoComplete?: string; minLength?: number; placeholder?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block font-pixel text-[8px] tracking-wider text-white/80 mb-2">{label}</label>
      <input
        id={id} type={type} value={value} autoComplete={autoComplete} minLength={minLength} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/5 border border-white/15 px-3 py-2.5 text-sm text-white placeholder:text-white/60"
      />
    </div>
  )
}
