export default function FillInput({ value, onChange, color, onEnter, light = false }: {
  value: string; onChange: (v: string) => void; color: string; onEnter?: () => void; light?: boolean
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
      placeholder="Type your answer"
      className={`w-full max-w-xs mx-auto block text-center text-xl font-semibold px-4 py-3 rounded-xl border outline-none ${
        light
          ? 'bg-black/[0.04] border-black/20 text-[#0a0620] placeholder-black/40'
          : 'bg-black/30 text-white placeholder-white/30'
      }`}
      style={light ? undefined : { borderColor: `${color}66` }}
    />
  )
}
