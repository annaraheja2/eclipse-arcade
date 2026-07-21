export default function FillInput({ value, onChange, color, onEnter }: {
  value: string; onChange: (v: string) => void; color: string; onEnter?: () => void
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
      placeholder="Type your answer"
      className="w-full max-w-xs mx-auto block text-center text-xl font-semibold px-4 py-3 rounded-xl bg-black/30 border text-white placeholder-white/30 outline-none"
      style={{ borderColor: `${color}66` }}
    />
  )
}
