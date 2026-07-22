import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { PlayerProvider } from './lib/player'
import { applyReducedMotion, isReducedMotion } from './lib/motion'
import './index.css'

// Apply the persisted reduced-motion preference before first paint.
applyReducedMotion(isReducedMotion())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <PlayerProvider>
          <App />
        </PlayerProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
