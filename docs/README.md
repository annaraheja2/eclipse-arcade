# Eclipse Arcade — Developer Docs

Eclipse Arcade is a neon-on-dark math game hub: a lobby of arcade "cabinets", each a
short game that awards XP, coins, and daily streaks. It is a fully client-side prototype
(version `0.1.0`) — React 18 + Vite 5 + TypeScript (strict) + Tailwind 3, no backend, all
progress persisted to `localStorage`. It is part of the Eclipse family and a sibling to
Eclipse Learning, but wears its own deliberately divergent neon identity.

## What is this / how do I run it (30 seconds)

```bash
# Node is not on PATH by default in this environment:
export PATH="/Users/annaraheja/.local/node/bin:$PATH"

npm install
npm run dev        # dev server on http://localhost:5174
```

Open the lobby, click a live cabinet (Battleship, PinPoint, or Slider), and play a round.
The build command — `npm run build` (`tsc && vite build`) — is the project's quality gate:
it must pass with zero TypeScript errors before any change is considered done.

## Table of contents

| Doc | What it covers |
|-----|----------------|
| [getting-started.md](./getting-started.md) | Prerequisites, install, the exact npm scripts, and how to verify a change |
| [architecture.md](./architecture.md) | Routing, the two content models, player state, scoring, Battleship logic, the pure-core split, and a data-flow diagram |
| [design-system.md](./design-system.md) | The neon-on-dark identity, palette hex values, fonts, effect classes, the no-emoji rule, and the accessibility risk |
| [content-authoring.md](./content-authoring.md) | Adding flat rounds vs. curriculum questions, which route uses which model, scoring and difficulty guidance |
| [adding-a-game.md](./adding-a-game.md) | The exact wiring steps to add a new cabinet (generic loop vs. bespoke route) |
| [conventions.md](./conventions.md) | Code conventions actually used: discriminated unions, pure core, strict TS, the build-is-the-gate rule |
| [roadmap.md](./roadmap.md) | Honest status: which cabinets are live vs. stubs, known structural debt, deploy state |
| [research-top-5-opportunities.md](./research-top-5-opportunities.md) | Dated product-research snapshot: top 5 high-leverage, easy-to-build additions with evidence and sources |
| [CHANGELOG.md](./CHANGELOG.md) | Keep-a-Changelog history seeded from the git log |

## Repository at a glance

```
eclipse-arcade/
  index.html              app shell; loads Inter + Press Start 2P fonts
  vite.config.ts          base: './', dev server on :5174
  tailwind.config.js      neon palette, pixel/sans fonts, floaty/pulseglow keyframes
  tsconfig.json           strict mode
  src/
    main.tsx              HashRouter -> PlayerProvider -> App
    App.tsx               route table
    index.css             global neon background + effect classes + Battleship FX
    icons.tsx             hand-drawn SVG line icons (no emoji)
    lib/
      games.ts            flat content model + pure scoring
      player.tsx          player state context + reward/streak/level helpers
      battleship.ts       pure 8x8 board logic
      sound.ts            synthesized Web Audio SFX
    data/
      subjects.ts         curriculum content model (Course -> Unit -> Subunit -> Question)
    pages/
      Lobby.tsx           the game registry rendered as cabinets
      Game.tsx            the generic pin/slider round loop
      Battleship.tsx      the bespoke Battleship screen
    components/           board/controller/avatar/question UI
```

> Note: there is no root `README.md` in this repo today. This `docs/` set is the primary
> developer documentation. Project-agent instructions live in the root `CLAUDE.md`, which
> is a contract for AI agents rather than human onboarding — these docs restate and expand
> the relevant facts for a human contributor.
