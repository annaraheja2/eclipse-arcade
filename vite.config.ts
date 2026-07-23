import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174 },
  build: {
    // Two chunks over Vite's 500 kB default, both lazily loaded vendor code:
    // firebase/firestore (~670 kB min, fetched only when VITE_FIREBASE_* is
    // set — see src/lib/firebase.ts) and three.js + react-three-fiber
    // (~875 kB min, fetched only when the Racer cabinet mounts — see the
    // lazy CircuitGL import in src/pages/Racer.tsx). Our own eager app chunk
    // stays ~380 kB; if either SDK grows past this, the warning returns.
    chunkSizeWarningLimit: 900,
  },
})
