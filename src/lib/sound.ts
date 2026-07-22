// Synthesized battle sound effects via Web Audio (no asset files).
// The mute preference is app-wide and persisted (Settings owns the canonical
// toggle); every mount reads the same stored value via isMuted(), so it no
// longer resets on reload.
const MUTE_KEY = 'eclipse-arcade:muted'
let ctx: AudioContext | null = null

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}
let muted = readMuted()

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}
export function setMuted(m: boolean) {
  muted = m
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* private mode: in-memory only */ }
}
export function isMuted() { return muted }

function noiseBuffer(a: AudioContext, dur: number) {
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function boom(a: AudioContext, when: number, { freq = 90, dur = 0.4, gain = 0.5, filter = 900 }) {
  // noise body
  const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur)
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(filter, when)
  lp.frequency.exponentialRampToValueAtTime(120, when + dur)
  const g = a.createGain(); g.gain.setValueAtTime(gain, when); g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  src.connect(lp).connect(g).connect(a.destination); src.start(when); src.stop(when + dur)
  // low thump
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, when)
  o.frequency.exponentialRampToValueAtTime(40, when + dur)
  const g2 = a.createGain(); g2.gain.setValueAtTime(gain * 0.8, when); g2.gain.exponentialRampToValueAtTime(0.001, when + dur)
  o.connect(g2).connect(a.destination); o.start(when); o.stop(when + dur)
}

function tone(a: AudioContext, { type, f0, f1, dur, gain, when = a.currentTime }: {
  type: OscillatorType; f0: number; f1: number; dur: number; gain: number; when?: number
}) {
  const o = a.createOscillator(); o.type = type
  o.frequency.setValueAtTime(f0, when)
  o.frequency.exponentialRampToValueAtTime(f1, when + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(gain, when); g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  o.connect(g).connect(a.destination); o.start(when); o.stop(when + dur)
}

// Placement feel: pick up / put down / rotate / rejected.
export function sfxPick() { if (muted) return; const a = ac(); tone(a, { type: 'triangle', f0: 300, f1: 430, dur: 0.08, gain: 0.14 }) }
export function sfxDrop() {
  if (muted) return; const a = ac()
  tone(a, { type: 'sine', f0: 190, f1: 85, dur: 0.11, gain: 0.3 })
  tone(a, { type: 'triangle', f0: 520, f1: 380, dur: 0.05, gain: 0.08 })
}
export function sfxRotate() { if (muted) return; const a = ac(); tone(a, { type: 'triangle', f0: 420, f1: 620, dur: 0.07, gain: 0.12 }) }
export function sfxDeny() {
  if (muted) return; const a = ac()
  tone(a, { type: 'square', f0: 150, f1: 110, dur: 0.07, gain: 0.09 })
  tone(a, { type: 'square', f0: 150, f1: 95, dur: 0.09, gain: 0.09, when: a.currentTime + 0.09 })
}

export function sfxFire() { if (muted) return; const a = ac(); boom(a, a.currentTime, { freq: 140, dur: 0.22, gain: 0.35, filter: 1600 }) }
export function sfxHit() { if (muted) return; const a = ac(); boom(a, a.currentTime, { freq: 80, dur: 0.55, gain: 0.6, filter: 1200 }) }
export function sfxMiss() {
  if (muted) return; const a = ac()
  const src = a.createBufferSource(); src.buffer = noiseBuffer(a, 0.3)
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1400, a.currentTime)
  bp.frequency.exponentialRampToValueAtTime(500, a.currentTime + 0.3)
  const g = a.createGain(); g.gain.setValueAtTime(0.35, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.3)
  src.connect(bp).connect(g).connect(a.destination); src.start(); src.stop(a.currentTime + 0.3)
}
export function sfxSink() {
  if (muted) return; const a = ac()
  boom(a, a.currentTime, { freq: 70, dur: 0.9, gain: 0.6, filter: 900 })
  const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(300, a.currentTime)
  o.frequency.exponentialRampToValueAtTime(60, a.currentTime + 0.9)
  const g = a.createGain(); g.gain.setValueAtTime(0.25, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.9)
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.9)
}
export function sfxWin() {
  if (muted) return; const a = ac()
  ;[523, 659, 784, 1047].forEach((f, i) => {
    const o = a.createOscillator(); o.type = 'square'; o.frequency.value = f
    const g = a.createGain(); const t = a.currentTime + i * 0.12
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.25)
  })
}
