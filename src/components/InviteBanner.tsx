// "You're setting this up for somebody" — shown on a game's setup screen when
// the Friends list sent you here to invite a specific friend.
//
// Arriving this way is a different errand from opening the game normally: you
// came to invite someone, so the screen drops its solo button and this line says
// what the screen is now for. Every cabinet shows the same one, tinted with its
// own accent, so the handoff reads the same wherever it lands.
const InviteBanner = ({ name, accent, hint }: {
  name: string
  accent: string
  /** What this cabinet needs before the invite goes out. Defaults to the shared
   *  table wording every gameRooms cabinet uses. */
  hint?: string
}) => (
  <div
    className="mb-5 rounded-xl border px-4 py-3 text-center"
    style={{ borderColor: `${accent}66`, background: `${accent}14` }}
  >
    <p className="font-pixel text-[9px] tracking-[0.16em]" style={{ color: accent }}>
      INVITING {name.toUpperCase()}
    </p>
    <p className="mt-1.5 text-sm text-white/75">
      {hint ?? `Pick one topic and open the table — ${name} gets the invite straight away.`}
    </p>
  </div>
)

export default InviteBanner
