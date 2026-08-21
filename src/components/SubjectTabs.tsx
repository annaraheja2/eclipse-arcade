// Math | Science, the one control that decides which courses a picker lists.
//
// Every cabinet's course picker carries this, tinted with that cabinet's own
// accent, so switching subject is the same gesture everywhere. It opens on the
// player's own subject (Settings → SUBJECT), which is what makes "the subject I
// want to be in" mean something without ever locking anybody out of the other
// one — a math player who fancies a chemistry round is one tap away.
//
// Selected state is carried by the accent colour, border and tint rather than
// by a filled button: bright neon on #0a0620 is the palette's AA-safe
// direction, and a filled neon button would need per-cabinet ink to stay
// legible (the violet and cyan cabinets want opposite text colours).
import { SUBJECTS, type SubjectId } from '../data/subjects'

export default function SubjectTabs({ value, onPick, accent, label = 'Subject' }: {
  value: SubjectId
  onPick: (subject: SubjectId) => void
  /** The cabinet's accent — the selected tab is tinted with it. */
  accent: string
  label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex justify-center gap-2 mb-5">
      {SUBJECTS.map((s) => {
        const selected = s.id === value
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={selected}
            title={s.blurb}
            onClick={() => onPick(s.id)}
            className={`font-sans font-bold text-sm tracking-wide px-6 py-2.5 rounded-lg border transition ${
              selected ? '' : 'border-white/12 bg-white/[0.03] text-white/60 hover:text-white/90 hover:border-white/25'}`}
            style={selected
              ? { borderColor: accent, background: `${accent}22`, color: accent }
              : undefined}
          >
            {s.name}
          </button>
        )
      })}
    </div>
  )
}
