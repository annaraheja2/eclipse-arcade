// On-screen arcade controller: a D-pad to steer the crosshair + a FIRE button.
export default function Controller({
  mode, onMove, onFire, color, fireLabel = 'FIRE', disabled,
}: {
  mode: 'pad' | 'lr'
  onMove: (dx: number, dy: number) => void
  onFire: () => void
  color: string
  fireLabel?: string
  disabled?: boolean
}) {
  const Pad = ({ dx, dy, glyph, cls }: { dx: number; dy: number; glyph: string; cls: string }) => (
    <button
      onClick={() => onMove(dx, dy)}
      disabled={disabled}
      className={`grid place-items-center w-11 h-11 rounded-lg bg-white/[0.06] border border-white/15 text-white/80 active:scale-90 active:bg-white/20 transition disabled:opacity-40 ${cls}`}
    >
      <span className="text-lg leading-none">{glyph}</span>
    </button>
  )

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      {/* D-pad */}
      {mode === 'pad' ? (
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-[141px]">
          <span /> <Pad dx={0} dy={1} glyph="▲" cls="" /> <span />
          <Pad dx={-1} dy={0} glyph="◀" cls="" /> <span className="grid place-items-center"><span className="w-3 h-3 rounded-full bg-white/15" /></span> <Pad dx={1} dy={0} glyph="▶" cls="" />
          <span /> <Pad dx={0} dy={-1} glyph="▼" cls="" /> <span />
        </div>
      ) : (
        <div className="flex gap-2">
          <Pad dx={-1} dy={0} glyph="◀" cls="w-14" />
          <Pad dx={1} dy={0} glyph="▶" cls="w-14" />
        </div>
      )}

      {/* FIRE */}
      <button
        onClick={onFire}
        disabled={disabled}
        className="grid place-items-center w-24 h-24 rounded-full font-pixel text-[10px] text-[#0a0620] active:scale-95 transition disabled:opacity-40"
        style={{ background: color, boxShadow: `0 0 26px ${color}, inset 0 -6px 0 rgba(0,0,0,0.25)` }}
      >
        {fireLabel}
      </button>
    </div>
  )
}
