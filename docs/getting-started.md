# Getting started

## Prerequisites

- **Node 22, at a non-standard location.** There is no system Node, npm, or Homebrew in
  this environment. A local Node lives at `~/.local/node`. Before running any `npm` or
  `npx` command, put it on your PATH:

  ```bash
  export PATH="/Users/annaraheja/.local/node/bin:$PATH"
  ```

  The `node` binary also works by absolute path (`~/.local/node/bin/node`) if you prefer
  not to alter PATH.

- No other services are required. There is no backend, no database, and no environment
  file — all state is client-side in the browser's `localStorage`.

## Install

```bash
export PATH="/Users/annaraheja/.local/node/bin:$PATH"
npm install
```

## The npm scripts (from `package.json`)

| Command | What it does |
|---------|--------------|
| `npm run dev` | Starts the Vite dev server on **http://localhost:5174** (port set in `vite.config.ts`). Hot module reload is on. |
| `npm run build` | Runs `tsc && vite build`. **This is the quality gate.** It type-checks the whole `src` tree in strict mode, then produces the static bundle in `dist/`. Must finish with zero TypeScript errors. |
| `npm run preview` | Serves the already-built `dist/` on **http://localhost:4173** so you can sanity-check the production bundle. Run `npm run build` first. |

There is no eslint config, no test runner, and no CI in the repo today. "Green before
commit" therefore means: `npm run build` passes cleanly and the browser console shows no
errors while you drive the flow.

## How to verify a change

1. `npm run dev` and open http://localhost:5174.
2. Drive the actual path you touched:
   - **Lobby** — the cabinet grid renders; live cabinets (Battleship, PinPoint, Slider)
     are clickable, "coming soon" ones are disabled.
   - **A generic game** (`/play/pinpoint` or `/play/slider`) — steer with the on-screen
     D-pad or the arrow keys, press FIRE / Space to lock in, and confirm the five rounds
     tally into a final score plus XP/coins rewards. Coins, streak, and level in the HUD
     should update after finishing.
   - **Battleship** (`/battleship`) — pick a unit and subunit, arrange the fleet, then
     solve a question to earn a shot.
3. `npm run build` — confirm zero TypeScript errors.
4. Watch the browser console for runtime errors or warnings; there should be none.

Progress lives under the `localStorage` key `eclipse-arcade:player`. To reset while
testing, clear that key (or run `localStorage.removeItem('eclipse-arcade:player')` in the
console) and reload.

For a non-trivial change, the project's `/ship-check` skill runs the full done-gate
(build plus parallel review and empirical verification) in one step.
