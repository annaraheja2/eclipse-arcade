// The ONE swappable placeholder figure shared by every 3D cabinet (card table,
// Ascend board): a team-tinted capsule torso + sphere head + visor + arms.
// Replace this component with real designs later — layouts and cameras in the
// consuming scenes stay untouched.

import { useMemo } from 'react'
import { Color as ThreeColor } from 'three'

// Per-seat tints, one per seat (0 = you) — shared so a player keeps the same
// color identity across cabinets.
export const SEAT_TINTS = ['#7c3aff', '#ff4d8d', '#3df5ff', '#3dffa2', '#ffb43d'] as const

export default function Character3D({ tint, dimmed, dimColor = '#3a2f45' }: {
  tint: string
  dimmed: boolean
  dimColor?: string // what a dimmed figure sinks toward (scene ambiance)
}) {
  const body = useMemo(() => {
    const c = new ThreeColor(tint)
    if (dimmed) c.lerp(new ThreeColor(dimColor), 0.3)
    return c
  }, [tint, dimmed, dimColor])
  const head = useMemo(() => {
    const c = new ThreeColor(tint).lerp(new ThreeColor('#ffffff'), 0.45)
    if (dimmed) c.lerp(new ThreeColor(dimColor), 0.3)
    return c
  }, [tint, dimmed, dimColor])
  return (
    <group>
      {/* torso */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.42, 0.7, 4, 12]} />
        <meshStandardMaterial color={body} roughness={0.7} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.95, 0]} castShadow>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshStandardMaterial color={head} roughness={0.6} />
      </mesh>
      {/* visor band — gives the head a facing */}
      <mesh position={[0, 1.96, 0.24]}>
        <boxGeometry args={[0.36, 0.13, 0.1]} />
        <meshStandardMaterial color="#2b2233" roughness={0.3} />
      </mesh>
      {/* arms resting forward */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.5, 1.0, 0.3]} rotation={[0.9, 0, s * -0.5]}>
          <capsuleGeometry args={[0.13, 0.55, 3, 8]} />
          <meshStandardMaterial color={body} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}
