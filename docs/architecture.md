# Architecture

## Entry point and routing

The app boots in `src/main.tsx`:

```
ReactDOM.createRoot(#root)
  └─ React.StrictMode
       └─ HashRouter
            └─ PlayerProvider          (player state context)
                 └─ App                (the route table)
```

`src/App.tsx` declares the routes:

| Path | Page component | Content model it uses |
|------|----------------|------------------------|
| `/` | `Lobby` | the game registry (`lib/games.ts`) |
| `/battleship` | `Battleship` | curriculum model (`data/subjects.ts`) |
| `/play/:gameKey` | `Game` | flat round model (`lib/games.ts`) |

### Why HashRouter + `base: './'`

`vite.config.ts` sets `base: './'`, and `main.tsx` uses `HashRouter` (not
`BrowserRouter`). These two choices are load-bearing: together they let the built bundle
be dropped onto **any** static host with no server-side routing or rewrite rules. The
router keeps all navigation in the URL fragment (`#/play/pinpoint`), so the server only
ever has to serve `index.html`, and relative asset paths resolve wherever the bundle is
mounted. Switching to `BrowserRouter` would mean owning host-level rewrites — do not do it
without that plan.

## The two content models (know which one you are extending)

This is the most important structural fact in the codebase: **two content models coexist
and are not unified.** Pick the one the target route already uses and do not cross-wire
them.

### 1. Flat model — `src/lib/games.ts`

A `GameDef` carries a `type` and a flat array of `Round`s. A `Round` is a discriminated
union keyed by `kind`:

```ts
interface PinRound    { kind: 'pin';    prompt: string; x: number; y: number; range: number }
interface SliderRound { kind: 'slider'; prompt: string; answer: number; min: number; max: number; step: number }
type Round = PinRound | SliderRound
```

This model drives the generic `/play/:gameKey` loop in `pages/Game.tsx`: it picks 5 random
rounds (`pickRounds`), lets you aim with the D-pad or arrow keys, FIRE to lock in, and
scores each round with exponential distance decay. **PinPoint** and **Slider** run on this
model.

### 2. Curriculum model — `src/data/subjects.ts`

A nested hierarchy with difficulty and a third answer type:

```
Course -> Unit -> Subunit -> Question
```

`difficulty` (`easy | medium | hard`) and `type` (`graph | slider | fill`) live on the
**Subunit**. A `Question` is a loose bag of optional fields; which fields are present tells
`components/QuestionPanel.tsx` how to render and check it:

- `x`/`y`/`range` present → a graph question (rendered with `PinBoard`)
- `answer`/`min`/`max`/`step` present → a slider question (rendered with `SliderBoard`)
- `fill` present → a text question (rendered with `FillInput`)

This model is currently wired into **Battleship only**, where solving a question is what
earns you a shot. `checkAnswer` in `QuestionPanel.tsx` is the pure answer-checker (graph:
within 0.5 on each axis; slider: within one step; fill: normalized string or numeric
match).

The two models are not converged. If they ever are, that is a deliberate refactor to plan,
not a drive-by change.

## Player state — `src/lib/player.tsx`

A React context persisted to `localStorage` under the key `eclipse-arcade:player`.

```ts
interface PlayerState {
  coins: number
  xp: number
  streak: number
  lastPlayed: string            // 'yyyy-mm-dd'
  bests: Record<string, number> // gameKey -> best total score
}
```

Pure helpers alongside the provider:

- **`levelFromXp(xp)`** — 500 XP per level (`XP_PER_LEVEL`). Returns `{ level, into, pct }`
  where `level = floor(xp / 500) + 1` and `pct` is progress into the current level.
- **`rewardsFor(score)`** — `xp = round(score / 10)`, `coins = round(score / 20)`. (A
  5000-point session is roughly one full level of XP plus ~250 coins.)
- **Streak rules** — inside `finishGame`: if today's date differs from `lastPlayed`, the
  streak becomes `prev.streak + 1` when the last play was *yesterday*, otherwise it resets
  to `1`. Playing multiple times the same calendar day does not change the streak.

**`finishGame(gameKey, score)` is the single write path.** It computes rewards, updates the
streak, records a per-game best (`bests[gameKey] = max(prev, score)`), persists the whole
state, and returns `{ xp, coins, best }`. Keep this the only place that mutates player
state — pages call it and render its return value, they do not touch `localStorage`
directly.

State loading is intentionally forgiving: `load()` shallow-merges the stored object over
`DEFAULT`, so new fields can be added safely. There is **no migration layer** — renaming or
repurposing an existing field would silently break existing saves.

## Scoring — `src/lib/games.ts`

`ROUND_MAX = 1000` is the per-round ceiling. Both scorers use exponential distance decay so
that a near-miss still pays out:

```ts
scorePin(r, gx, gy)  = round(1000 * exp(-dist / (r.range / 5)))     // dist = hypot(gx-r.x, gy-r.y)
scoreSlider(r, g)    = round(1000 * exp(-|g - r.answer| / ((r.max - r.min) / 30)))
```

These are pure functions. If you touch the decay curve, keep them pure and cover them with
Vitest.

`Game.tsx` runs five rounds (`TOTAL_ROUNDS = 5`), sums the per-round points, and passes the
total to `finishGame`. The final screen shows the total out of `ROUND_MAX * rounds`.

## Battleship board logic — `src/lib/battleship.ts`

All board rules are pure and live in the lib; `pages/Battleship.tsx` owns the React state,
phases, and question gating.

- **Board:** `N = 8` (an 8×8 grid).
- **Fleet:** five ships — one carrier (size 4), two cruisers (size 3), two destroyers
  (size 2).
- **"No ships touch" placement (`placementOk`):** a candidate placement is legal only if
  every cell is in bounds and none overlaps *or is adjacent to* an existing ship —
  adjacency includes diagonals (it blocks the full 3×3 neighborhood around each occupied
  cell). This is the classic no-touching rule.
- **Pure geometry helpers:** `shipCells`, `inBounds`, `isHoriz`, `anchorOf`, `moveShip`,
  `rotateShip`, and `nearestValidAnchor` (finds the closest legal anchor by Chebyshev-ring
  search). `randomFleet` places the whole fleet legally, restarting on the rare failure.
- **Firing:** `resolveFire` / `applyFire` return `'miss' | 'hit' | 'sunk'`; `isSunk`,
  `allSunk`, and `aiPick` (a random unshot cell) drive win detection and the AI's turn.

> The Battleship *placement interaction* (how the player selects, moves, and rotates ships
> on screen) is being actively improved and its exact gestures are in flux. The pure board
> and legality rules described above are stable; treat the on-screen gesture details as
> subject to change and read `pages/Battleship.tsx` for the current UX.

Battleship rewards are fixed, not distance-scored: `finishGame('battleship', 3000)` on a
win, `500` on a loss.

## The pure-core / effects-at-the-edges split

The consistent pattern throughout the codebase:

- **Pure core in `lib/` and `data/`** — scoring, reward/streak/level math, and all
  Battleship board legality are pure functions with no I/O. They are the parts worth unit
  testing.
- **Effects at the edges** — `localStorage` (in `player.tsx`), keyboard handling (in
  `Game.tsx`), and audio (`lib/sound.ts`, synthesized via the Web Audio API with no asset
  files) live in the components and provider, not in the pure logic.

Hold this split when adding anything: new game rules go in `lib/` as pure functions; React
state and side effects stay in the page or component.

## Data flow (text diagram)

```
                     localStorage['eclipse-arcade:player']
                                    ^  |
                          save(next)|  |load()
                                    |  v
  ┌──────────────────────── PlayerProvider (lib/player.tsx) ───────────────────────┐
  │  state: { coins, xp, streak, lastPlayed, bests }                               │
  │  finishGame(gameKey, score)  ── the single write path ──> returns {xp,coins,best}│
  └───────────────▲──────────────────────────────────▲───────────────────────────┘
                  │ usePlayer()                       │ usePlayer()
                  │                                   │
        ┌─────────┴─────────┐               ┌─────────┴──────────┐
        │  Game.tsx         │               │  Battleship.tsx    │
        │  /play/:gameKey   │               │  /battleship       │
        │                   │               │                    │
        │ getGame(key)      │               │ COURSES[0]         │
        │  -> GameDef       │               │  Course->Unit->    │
        │ pickRounds(5)     │               │  Subunit->Question │
        │  -> Round[]       │               │ placementOk /      │
        │ scorePin/         │               │ resolveFire /      │
        │ scoreSlider       │               │ allSunk (pure)     │
        │  (lib/games.ts)   │               │  (lib/battleship)  │
        └─────────┬─────────┘               └─────────┬──────────┘
                  │ renders                            │ renders
        PinBoard / SliderBoard /            BattleGrid / Warship /
        Controller / Avatar                 QuestionPanel / sound.ts

  Lobby.tsx (/) reads GAMES from lib/games.ts and usePlayer() for HUD + per-game bests,
  then navigates to /play/:key or /battleship.
```
