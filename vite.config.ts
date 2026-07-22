import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174 },
  build: {
    // The one chunk over Vite's 500 kB default is firebase/firestore (~670 kB
    // min), a lazily-loaded vendor chunk that is only ever fetched when the
    // VITE_FIREBASE_* env vars are set (see src/lib/firebase.ts). Our own eager
    // app chunk stays ~250 kB; if the SDK grows past this, the warning returns.
    chunkSizeWarningLimit: 700,
  },
})
