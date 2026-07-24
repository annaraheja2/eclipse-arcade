import type { SVGProps } from 'react'
const s = (p: SVGProps<SVGSVGElement>) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p,
})
export const Moon = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)} fill="currentColor" stroke="none"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>)
export const Search = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>)
export const Coin = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6H9.8M9.5 12h3.5a1.8 1.8 0 0 1 0 3.6H9" /></svg>)
export const Flame = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)} fill="currentColor" stroke="none"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-1 .5-2 1-2.5C8 10 8 8 8 8s1 1 2 1c0-2 2-4 2-7z" /></svg>)
export const Bolt = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)} fill="currentColor" stroke="none"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>)
export const Users = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 6M17.5 20a5.5 5.5 0 0 0-3-4.9" /></svg>)
export const Bell = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M18 8a6 6 0 1 0-12 0c0 6-2 8-2 8h16s-2-2-2-8M10 20a2 2 0 0 0 4 0" /></svg>)
export const User = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>)
// game icons
export const Target = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>)
export const Slide = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M3 12h18" /><circle cx="9" cy="12" r="3" fill="currentColor" /></svg>)
export const Grid = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 12h16M12 4v16" /></svg>)
export const Link2 = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M9 12h6M8.5 8.5H7a3.5 3.5 0 0 0 0 7h1.5M15.5 8.5H17a3.5 3.5 0 0 1 0 7h-1.5" /></svg>)
export const Chart = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M4 20 20 6" /><circle cx="7" cy="16" r="1.2" fill="currentColor" /><circle cx="12" cy="13" r="1.2" fill="currentColor" /><circle cx="16" cy="8" r="1.2" fill="currentColor" /></svg>)
export const Star = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)} fill="currentColor" stroke="none"><path d="m12 3 2.7 5.9 6.3.6-4.8 4.2 1.5 6.3L12 17.8 6.3 20.2l1.5-6.3L3 9.5l6.3-.6z" /></svg>)
export const ArrowLeft = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M19 12H5M11 5l-7 7 7 7" /></svg>)
export const Replay = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>)
export const Ship = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M3 14h18l-2.2 5.2a1 1 0 0 1-.9.6H6.1a1 1 0 0 1-.9-.6zM6 14V8l6-3 6 3v6M9 8h6M12 5V2" /></svg>)
export const Volume = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M4 9v6h3.5L13 20V4L7.5 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" /></svg>)
export const VolumeMute = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M4 9v6h3.5L13 20V4L7.5 9zM17 9.5l4 5M21 9.5l-4 5" /></svg>)
export const Rotate = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M20 11a8 8 0 1 0-1.8 5.4M20 5v5h-5" /></svg>)
export const Flag = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>)
export const Cards = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><rect x="9" y="6" width="11" height="14" rx="2" /><path d="M6.5 8.2 4.2 9.1a1.6 1.6 0 0 0-.95 2.05l2.6 6.8M14.5 12.5h0" /></svg>)
export const Gear = (p: SVGProps<SVGSVGElement>) => (<svg {...s(p)}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>)
