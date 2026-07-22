import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { usePlayer } from '../lib/player'
import UsernamePicker from './UsernamePicker'

// A gentle, NON-blocking nudge for a signed-in player who hasn't chosen a
// handle yet — they can dismiss it and keep playing. Renders nothing once a
// username is set, dismissed, or when there's no email to anchor the account.
export default function UsernamePrompt() {
  const { user } = useAuth()
  const { player, setUsername } = usePlayer()
  const [dismissed, setDismissed] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (!user || !user.email || player.username || dismissed) return null

  return (
    <>
      <div
        role="region"
        aria-label="Choose a username"
        className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-neon-cyan/40 bg-neon-cyan/[0.07] px-4 py-3.5"
      >
        <p className="flex-1 text-sm text-white/90">
          Pick a username so friends and opponents see a name instead of your email.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setPickerOpen(true)}
            className="font-pixel text-[9px] px-4 py-2.5 rounded-lg bg-neon-cyan text-[#06121a] hover:brightness-110"
          >
            CHOOSE USERNAME
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="font-pixel text-[9px] px-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white/80 hover:bg-white/10"
          >
            LATER
          </button>
        </div>
      </div>
      {pickerOpen && (
        <UsernamePicker
          uid={user.uid}
          email={user.email}
          onClose={() => setPickerOpen(false)}
          onSaved={(u) => { setUsername(u); setPickerOpen(false) }}
        />
      )}
    </>
  )
}
