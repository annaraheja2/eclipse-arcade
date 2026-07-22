---
name: add-game
description: Add a new playable game (or a "coming soon" cabinet) to Eclipse Arcade end-to-end, wiring every file so nothing is half-connected. Use when the user asks to add/create a new game, cabinet, or arcade mode in the eclipse-arcade project.
---

# add-game — new arcade cabinet, fully wired

Read the repo `CLAUDE.md` first. A game touches several files; the common bug is wiring
some but not all. Follow every step, then verify the build.

## 1. Decide the content model (ask if unclear)
- **Generic pin/slider loop** (aim with D-pad, FIRE to lock in): use the flat `Round` model
  in `lib/games.ts`. Cheapest — no new screen needed.
- **Bespoke mechanic** (like Battleship, with its own board/rules): you'll add a dedicated
  page + route, and — if it's curriculum-gated — the `Course→Unit→Subunit→Question` model
  in `data/subjects.ts`. Do NOT cross-wire the two models.

## 2. Register the game — `lib/games.ts`
Add a `GameDef` to the `GAMES` array:
- unique `key` (kebab), display `name`, an accent `color` (a neon hex — see palette in
  `tailwind.config.js`), and `type`.
- `type: 'soon'` → renders a disabled "coming soon" cabinet, no route needed. Stop here for a placeholder.
- For a pin/slider game, add its `PinRound[]` / `SliderRound[]` (use the `pin()` / `sl()` helpers)
  and set `type: 'pin'` or `'slider'`. That's all a generic game needs.

## 3. Wire the lobby icon — `pages/Lobby.tsx`
Add an entry to the `ICON` map keyed by the new `key`, using an SVG from `icons.tsx`
(add a new line icon there if none fits — **no emojis**, match the existing stroke style).

## 4. Bespoke screen only — `App.tsx` + lobby nav
If `type` is a custom mechanic: create `pages/<Name>.tsx`, add a `<Route>` in `App.tsx`,
and branch the `Cabinet` navigation in `pages/Lobby.tsx` (see how `battleship` routes to
`/battleship` instead of `/play/:key`). Keep pure game logic in a `lib/` module; keep React
state/effects in the page.

## 5. Verify
- Accent color text must hit **WCAG AA** against `#0a0620` — glow is not legibility.
- Build is the gate: `export PATH="/Users/annaraheja/.local/node/bin:$PATH" && npm run build`
  — zero TS/console errors.
- Then load `npm run dev` (:5174), confirm the cabinet appears and (if playable) a full
  5-round session scores and awards rewards. Report what you actually saw.
