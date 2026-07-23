/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        display: ['Bungee', '"Press Start 2P"', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Racer only — the motorsport-broadcast face. Deliberately NOT font-pixel:
        // Racer is the arcade's one non-retro cabinet (see CLAUDE.md → Racer).
        race: ['"Titillium Web"', 'Inter', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        neon: {
          cyan: '#3df5ff',
          magenta: '#ff3df0',
          purple: '#a24bff',
          violet: '#7c3aff',
          pink: '#ff4d8d',
          amber: '#ffb43d',
          green: '#3dffa2',
          blue: '#4d8dff',
        },
        // Racer's cartoon-circuit palette. `carbon`/`slate` are the HUD surfaces
        // every label sits on, so text never has to fight the sky for contrast.
        track: {
          carbon: '#12151c',
          slate: '#1e2430',
          asphalt: '#3c4250',
          kerb: '#e4322b',
          grass: '#49a94b',
          sky: '#7fd0ff',
          sun: '#ffd76a',
        },
      },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        pulseglow: { '0%,100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
      },
      animation: {
        floaty: 'floaty 5s ease-in-out infinite',
        pulseglow: 'pulseglow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
