// The end-of-session readout: how the player did, and which subtopics to
// review. Shared by the Practice tab and every question-gated game, so it takes
// its accent `color` from the caller and carries no game-specific chrome.
//
// The tallying is pure and lives in lib/summary.ts.
import type { SessionSummary as Summary, SubtopicTally } from '../lib/summary'

const OK = '#3dffa2'
const WARN = '#ffb43d'
const MISS = '#ff9dbd'

/** Accuracy colour, matched to the thresholds lib/summary.ts judges on. */
function toneFor(pct: number): string {
  if (pct >= 80) return OK
  if (pct >= 60) return WARN
  return MISS
}

// `caption` overrides the line under the percentage. The aim-and-fire loop
// (Daily) has no right/wrong, so "3 of 5 correct" would be the wrong words for
// it — it passes its own.
export default function SessionSummary({ summary, color, title = 'SESSION SUMMARY', caption }: {
  summary: Summary; color: string; title?: string; caption?: string
}) {
  const { answered, correct, pct, bySubtopic, struggling, strong } = summary
  if (answered === 0) return null

  // Thin accent text on the dark field is brightened for AA; the accent itself
  // is only ever a fill or a border.
  const accentText = `color-mix(in srgb, ${color} 62%, #fff)`

  return (
    <section aria-label="Session summary" className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-center font-sans font-bold text-xs tracking-[0.18em] mb-4" style={{ color: accentText }}>
        {title}
      </h3>

      <p className="text-center mb-1">
        <span className="font-pixel text-2xl tabular-nums" style={{ color: toneFor(pct) }}>{pct}%</span>
      </p>
      <p className="text-center text-sm text-white/70 mb-5">
        {caption ?? `${correct} of ${answered} correct`}
      </p>

      {bySubtopic.length > 0 && (
        <ul className="grid gap-2 mb-4">
          {bySubtopic.map((t) => <Row key={t.subunitId} t={t} />)}
        </ul>
      )}

      {struggling.length > 0 && (
        <Advice tone={MISS} label="Worth another look">
          {list(struggling)}
        </Advice>
      )}
      {strong.length > 0 && (
        <Advice tone={OK} label="Going well">
          {list(strong)}
        </Advice>
      )}
    </section>
  )
}

function Row({ t }: { t: SubtopicTally }) {
  const tone = toneFor(t.pct)
  return (
    <li className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-white/85">{t.name}</span>
      <span aria-hidden className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
        <span className="block h-full rounded-full" style={{ width: `${t.pct}%`, background: tone }} />
      </span>
      <span className="shrink-0 w-16 text-right text-xs tabular-nums" style={{ color: tone }}>
        {t.correct}/{t.answered}
      </span>
    </li>
  )
}

function Advice({ tone, label, children }: { tone: string; label: string; children: string }) {
  return (
    <p className="text-sm text-white/80 mt-2">
      <span className="font-semibold" style={{ color: tone }}>{label}:</span> {children}
    </p>
  )
}

function list(tallies: readonly SubtopicTally[]): string {
  const names = tallies.map((t) => t.name)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
