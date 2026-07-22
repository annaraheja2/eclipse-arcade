// Fleet status readout: one glowing bar per ship, dimmed once sunk. Shared by
// the vs-AI battle (Battleship) and the live PvP battle (BattleshipPvp).
import { isSunk, type Ship } from '../lib/battleship'

export default function FleetPips({ ships, color, label, align }: {
  ships: Ship[]; color: string; label: string; align?: 'right'
}) {
  return (
    <div className={`flex items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span className="font-pixel text-[8px] text-white/60">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {ships.map((s) => (
          <span key={s.id} className="h-[6px] rounded-[2px] transition-all" style={{
            width: s.size * 5,
            background: isSunk(s) ? 'rgba(255,255,255,0.14)' : color,
            boxShadow: isSunk(s) ? 'none' : `0 0 6px ${color}99`,
          }} />
        ))}
      </span>
    </div>
  )
}
