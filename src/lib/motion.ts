// Reduced-motion preference — persisted app-wide and applied as a data attribute
// on <html>. index.css broadens its `prefers-reduced-motion` rules to also fire
// under `:root[data-reduced-motion="true"]`, so this toggle stills every
// decorative animation exactly like the OS setting. Effects live at this
// boundary; the toggle in Settings is the canonical control.
const KEY = 'eclipse-arcade:reduced-motion'

/** The stored preference (false when unset or storage is unavailable). */
export function isReducedMotion(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** Reflects the preference onto <html> so the CSS selector matches. */
export function applyReducedMotion(on: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (on) root.setAttribute('data-reduced-motion', 'true')
  else root.removeAttribute('data-reduced-motion')
}

/** Persists the preference and applies it immediately. */
export function setReducedMotion(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode: this session only */ }
  applyReducedMotion(on)
}
