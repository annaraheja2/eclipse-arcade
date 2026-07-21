export type Mood = 'idle' | 'aim' | 'happy' | 'sad'

// A little neon bot that reacts to how you're doing.
export default function Avatar({ mood = 'idle', color = '#3df5ff', size = 64 }: { mood?: Mood; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}>
      {/* antenna */}
      <line x1="32" y1="8" x2="32" y2="16" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="7" r="3" fill={color} />
      {/* head */}
      <rect x="12" y="16" width="40" height="34" rx="12" fill="#0e0a24" stroke={color} strokeWidth="2.5" />
      {/* visor */}
      <rect x="18" y="23" width="28" height="18" rx="8" fill={`${color}22`} stroke={`${color}66`} strokeWidth="1.5" />
      {/* eyes */}
      {mood === 'happy' ? (
        <>
          <path d="M22 32 q3 -4 6 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M36 32 q3 -4 6 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : mood === 'sad' ? (
        <>
          <path d="M22 30 q3 4 6 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M36 30 q3 4 6 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : mood === 'aim' ? (
        <>
          <rect x="23" y="29" width="5" height="5" rx="1" fill={color} />
          <circle cx="39" cy="31.5" r="2.6" fill={color} />
        </>
      ) : (
        <>
          <circle cx="25.5" cy="31.5" r="2.6" fill={color} />
          <circle cx="38.5" cy="31.5" r="2.6" fill={color} />
        </>
      )}
      {/* mouth */}
      {mood === 'happy' ? (
        <path d="M26 44 q6 6 12 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      ) : mood === 'sad' ? (
        <path d="M26 47 q6 -6 12 0" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <line x1="27" y1="45" x2="37" y2="45" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  )
}
