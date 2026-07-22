# Design system

## A deliberately divergent identity

Eclipse Arcade shares DNA with the rest of the Eclipse family — the **Inter** typeface for
body text, hand-drawn SVG line icons, and a strict **no-emoji** rule — but it deliberately
does **not** share the palette. Eclipse Learning is beige-and-espresso; **Eclipse Arcade is
neon-on-dark.** This divergence is intentional. Do not "correct" the arcade back toward the
beige theme.

## Background and color scheme

Set globally on `body` in `src/index.css`, with `color-scheme: dark` on `:root`:

- Base color: `#0a0620` (a very dark violet).
- Three layered neon radial gradients bleed over it — purple from the top-left, cyan from
  the top-right, magenta from the bottom — all `background-attachment: fixed`.
- A faint 40px grid overlay (`.grid-floor`, radially masked toward the top) gives the
  arcade-floor feel; it is rendered `pointer-events: none` behind the content on the Lobby
  and Game pages.

## Fonts

Both are loaded from Google Fonts in `index.html` and mapped in `tailwind.config.js`:

- **`font-pixel`** — `"Press Start 2P"` (monospace fallback). Used for headings, labels,
  score readouts, and button captions — the retro-arcade voice.
- **`font-sans`** — `Inter` (with system fallbacks). Used for body copy and question
  prompts.

## Neon palette

Defined under `theme.extend.colors.neon` in `tailwind.config.js`:

| Token | Hex | Used for (examples) |
|-------|-----|---------------------|
| `neon-cyan` | `#3df5ff` | Battleship accent, XP/level, "SELECT A GAME" heading |
| `neon-magenta` | `#ff3df0` | "ARCADE" wordmark, level-bar gradient |
| `neon-purple` | `#a24bff` | PinPoint accent, HUD logo gradient |
| `neon-violet` | `#7c3aff` | HUD logo gradient |
| `neon-pink` | `#ff4d8d` | Match-Up accent, notification dot |
| `neon-amber` | `#ffb43d` | Coins, Slider / Daily accent, "NEW BEST" badge |
| `neon-green` | `#3dffa2` | Grid-Fill accent, correct-answer markers |
| `neon-blue` | `#4d8dff` | HUD profile button gradient |

Each game carries its own accent `color` in its `GameDef`, and the cabinet, board reticle,
FIRE button, and glow are themed from that per game. Note that one cabinet — Fit-the-Line —
uses an orange `#ff6b3d` that is **not** part of the `neon` palette; a couple of orange
accents (streak flame, low-score round numbers) use it inline too. If you formalize that
color, add it to the palette rather than sprinkling more hex literals.

## Effect classes and keyframes

In `src/index.css`:

- **`.neon-text`** — a `text-shadow` glow (`0 0 8px` + `0 0 22px` of `currentColor`). Used
  on the wordmark and score readouts.
- **`.grid-floor`** — the masked arcade-floor grid overlay described above.
- **Battleship ocean + FX** — an animated ocean (`.ocean` with `waveA`/`waveB` scrolling
  wave layers and a `bob` motion) plus impact effects: `.fx-fire` (`boom`), `.fx-smoke`
  (`smoke`), `.fx-splash` (`splash`), `.fx-shell` (`shelldrop`), and `.miss-dot`. These
  power the hit/miss/sink visuals on the board.

In `tailwind.config.js` (available as Tailwind `animate-*` utilities):

- **`floaty`** — a gentle 5s vertical bob (`animate-floaty`).
- **`pulseglow`** — a 2.4s opacity pulse (`animate-pulseglow`).

## Iconography and the no-emoji rule

All icons are hand-drawn SVG line icons in `src/icons.tsx`, sharing a common stroke style
(1.9px round-cap/round-join, `currentColor`). There are **no emojis anywhere** in the UI —
this is a hard repo rule. When you need a glyph, add an SVG icon to `icons.tsx` and wire it
through the `ICON` map in `Lobby.tsx`; do not reach for an emoji.

## Accessibility: the real risk on dark neon

Glowing thin text on a near-black field fails WCAG AA contrast very easily, and the glow
does **not** count toward legibility. This is the primary accessibility hazard in this UI.
When you add any text or control:

- Verify contrast of the actual text color against the `#0a0620` background hits AA — do
  not rely on `.neon-text` glow to carry it.
- Give icon-only controls accessible labels; the pixel font at small sizes is especially
  hard to read, so keep critical readouts large enough.
- Preserve keyboard play. The generic game loop (`Game.tsx`) already supports arrow keys to
  aim and Space/Enter to fire and advance — keep that working when you touch it.
