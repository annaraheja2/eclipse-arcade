# Eclipse Arcade

A neon math-game hub: a lobby of arcade "cabinets", each a short 5-round game that
awards XP, coins, and streaks. Part of the Eclipse family (github.com/annaraheja2/eclipse-arcade),
sibling to Eclipse Learning (`~/app/studyreel-web`).

Global standards in `~/.claude/CLAUDE.md` apply on top of everything here. Read this
file before making structural changes.

---

## Stack & commands

React 18 · Vite 5 · TypeScript 5 (`strict`) · Tailwind 3 · react-router-dom 6. No
backend — all state is client-side in `localStorage`.

Node isn't on PATH by default:
```
export PATH="/Users/annaraheja/.local/node/bin:$PATH"
```
- `npm run dev` — dev server on **:5174**
- `npm run build` — `tsc && vite build`. **This is the quality gate.** Zero TS errors, zero console errors.
- `npm run preview` — serve the built `dist/` on :4173

There is **no eslint, no test runner, and no CI yet** (the lone `eslint-disable` comment
in `Game.tsx` is vestigial). "Green before commit" therefore means `npm run build` passes
cleanly. If you add non-trivial pure logic (scoring, streak/reward math, placement rules),
add Vitest rather than leaving it untested — those are the functions worth covering.

---

## Deploy & delivery — standing authorization

**This overrides the global "never commit/push unless I ask" rule — for this repo only.**
Harish has given standing authorization to ship without a round-trip: **whenever a change
worth testing is built and green, take it all the way to live.** "Worth testing" means a
user-facing increment he'd actually want to click through — not every intermediate step.

The flow, in order:
1. **Gate green first.** `npm run build` clean (zero TS/console errors) and any Vitest
   passing. Never commit, push, or deploy a red build or a half-finished feature.
2. **Commit** — clear imperative subject, one logical change (don't mix refactor + feature).
   End the message with the standard `Co-Authored-By: Claude` trailer.
3. **Integrate & sync `main`.** If on a feature branch, merge it into `main`. `git pull
   --rebase` to sync with origin, then `git push`. Resolve conflicts deliberately —
   never force-push `main`.
4. **Deploy live to GitHub Pages.** Publish the built `dist/` to the **`gh-pages`** branch
   (`npx gh-pages -d dist`, or a `deploy` npm script if one exists). Force-pushing the
   built output to `gh-pages` is expected — it holds generated files only, not source.
   Live URL: **https://annaraheja2.github.io/eclipse-arcade/** (refreshes in ~1 min).
5. **Report** the live URL and exactly what to test.

Guardrails: no secrets in the bundle (client-only app; none expected). If a push/merge
conflicts or the deploy fails, **stop and surface it** — don't paper over it. Scope is this
repo only; everywhere else the global "never commit/push unless asked" still holds.

---

## Architecture

Entry: `main.tsx` → `HashRouter` → `PlayerProvider` → `App`.

**`HashRouter` + `base: './'` are load-bearing** — the app is a static bundle meant to be
dropped on any static host (like Eclipse Learning on GitHub Pages) with no server-side
routing. Don't switch to `BrowserRouter` without also owning the hosting rewrite rules.

Routes (`App.tsx`):
| Path | Page | Content model |
|------|------|---------------|
| `/` | `Lobby` | the game registry |
| `/battleship` | `Battleship` | curriculum model (`data/subjects.ts`) |
| `/play/:gameKey` | `Game` | flat round model (`lib/games.ts`) |

### Two content models coexist — know which you're extending
This is the biggest thing to understand before adding content or a game:

1. **Flat model** — `lib/games.ts`. A `GameDef` has a `type` and a flat list of `Round`s
   (`PinRound | SliderRound`, discriminated by `kind`). Drives the generic `/play/:gameKey`
   loop (`Game.tsx`): 5 random rounds, aim with D-pad/arrows, FIRE to lock in, exponential
   scoring. PinPoint and Slider run on this.

2. **Curriculum model** — `data/subjects.ts`. `Course → Unit → Subunit → Question`, with
   difficulty and a third answer type (`fill`, via `FillInput`/`QuestionPanel`). Currently
   wired **only into Battleship**, where solving a question is what lets you fire.

These are not unified yet. When touching content, pick the model the target route already
uses; don't cross-wire them. If they ever converge, that's a deliberate refactor to plan,
not a drive-by.

### Player state — `lib/player.tsx`
React context, persisted to `localStorage` under `eclipse-arcade:player`.
`{ coins, xp, streak, lastPlayed, bests }`. Pure helpers live alongside the provider:
- `levelFromXp` — 500 XP per level.
- `rewardsFor(score)` — `xp = score/10`, `coins = score/20`.
- Streak increments once per calendar day; resets if a day is skipped.

`finishGame(gameKey, score)` is the single write path (updates rewards, streak, and
per-game best). Keep this the only place that mutates player state.

### Scoring — `lib/games.ts`
`ROUND_MAX = 1000`. Both scorers use exponential distance decay so "close" still pays out.
These are **pure** — keep them pure and test them if you touch the curve.

### Battleship — `lib/battleship.ts`
8×8, a 5-ship fleet, classic **"no ships touch"** placement (overlap *or* adjacency,
including diagonals, is blocked — see `placementOk`). Board/scoring logic is pure and
lives in the lib; `pages/Battleship.tsx` owns the React state and the question gating.

---

## Design system — the arcade's own identity

**Deliberate divergence:** Eclipse Learning is beige/espresso; **Eclipse Arcade is
neon-on-dark.** Don't "correct" the arcade back to the beige theme — the shared DNA is
Inter for body text, hand-drawn SVG line icons (`icons.tsx`), and **no emojis**, not the
color palette.

- **Background:** `#0a0620` base with layered neon radial gradients; `color-scheme: dark`.
- **Fonts:** `font-pixel` (Press Start 2P) for headings, labels, and score readouts;
  `font-sans` (Inter) for body/prompts. Both loaded in `index.html`.
- **Neon palette** (`tailwind.config.js` → `colors.neon`): cyan `#3df5ff`, magenta
  `#ff3df0`, purple `#a24bff`, violet `#7c3aff`, pink `#ff4d8d`, amber `#ffb43d`,
  green `#3dffa2`, blue `#4d8dff`. Each game carries its own accent `color` in its
  `GameDef`; UI (glow, buttons, borders) is themed from that per game.
- **Effects:** `.neon-text` glow, `.grid-floor` arcade-floor overlay, `floaty`/`pulseglow`
  animations, and the ocean/FX keyframes for Battleship — all in `index.css`.
- **Accessibility on dark neon is the real risk here.** Glowing thin text on a dark field
  fails AA easily. Verify contrast of any new text/control against `#0a0620`; don't rely
  on the glow to carry legibility. Icons and controls need labels; keyboard play already
  works in `Game.tsx` (arrows + space/enter) — preserve it.

---

## Adding a game (the common change)

1. Add a `GameDef` to `GAMES` in `lib/games.ts` (unique `key`, accent `color`, `type`).
   Use `type: 'soon'` to show a disabled "coming soon" cabinet with no route.
2. Add its icon to the `ICON` map in `pages/Lobby.tsx` (SVG from `icons.tsx`).
3. If it uses the generic pin/slider loop, add `Round`s and you're done — `/play/:key`
   renders it automatically. If it needs a bespoke screen (like Battleship), add a
   `<Route>` in `App.tsx` and branch the lobby's navigation in `Cabinet`.

Keep new game logic **pure and in `lib/`**; keep React state and effects in the page/
component. That split is the pattern throughout — hold it.

---

## Repo conventions

- **Discriminated unions over flags** for round/question shapes (`kind`, `type`) — exhaustively narrowed.
- **Pure core in `lib/`, effects at the edges.** Scoring, streak/reward, and placement
  rules are pure functions; `localStorage`, keyboard, and audio (`lib/sound.ts`) live at boundaries.
- **`strict` TS, no `any`.** Narrow `unknown`; model round types as unions, not optionals-with-casts.
- Match the existing terse, single-purpose style in `lib/` (short pure helpers) and the
  component style in `pages/`/`components/`.

---

## Agents & delegation

This repo has purpose-built subagents. **Match the task to the right agent, and run
independent work in parallel** — when subtasks don't depend on each other, dispatch them in
a single message (multiple Agent calls) so they execute concurrently rather than in series.

| Task | Agent | Where |
|------|-------|-------|
| Implement/modify a feature here (game, scoring, player logic, Battleship) | `arcade-builder` | this project (`.claude/agents/`) |
| Review a diff against the 9.5 bar before done/commit/PR | `tier1-reviewer` | global |
| Check design-system + WCAG AA (neon-on-dark) consistency | `eclipse-web-guardian` | global |
| Empirically confirm a change runs (build, boot, drive the flow) | `run-verify` | global |

**Skills** (invoke with `/name`): `/add-game` (new cabinet, fully wired), `/add-content`
(author rounds/questions into the right model), and the global `/ship-check` (the 9.5
done-gate: build + parallel review + verify).

**Default workflow for a non-trivial change:** `arcade-builder` implements → `/ship-check`
fans out `tier1-reviewer`, `eclipse-web-guardian`, and `run-verify` **in parallel** on the
result (they don't depend on each other) → address what they surface. A change isn't done
until review is clean and it's been verified running — not reasoned about. Prefer delegating
a self-contained chunk to a subagent over doing everything in the main thread, so context
stays focused.

## In-flight / gotchas

- **Prototype (`0.1.0`).** Sample content is placeholder ("replace with team-authored
  questions later"); several cabinets are `type: 'soon'`. Real content is expected to
  land in the curriculum model.
- **Two content models** (above) are the main structural debt.
- **Deploy is live but manual.** Remote is `github.com/annaraheja2/eclipse-arcade`; GitHub
  Pages already serves from the **`gh-pages`** branch at
  https://annaraheja2.github.io/eclipse-arcade/ (`base: './'` makes the project-subpath work).
  There's no `deploy` script or CI workflow yet — publishing is a manual `dist/` → `gh-pages`
  push. See **Deploy & delivery** above for the standing ship-it-when-green flow.
- **No persisted-state migration.** Changing the `PlayerState` shape can break existing
  `localStorage`; `load()` shallow-merges over `DEFAULT`, so add fields safely but don't
  rename/repurpose without a migration.
