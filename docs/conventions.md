# Code conventions

These are the conventions actually in force in the codebase today. Match them; they keep
the code small and readable.

## Discriminated unions over boolean flags

Round and question shapes are modeled as unions with a discriminant, then narrowed
exhaustively — never as a bag of optionals plus casts elsewhere:

- `Round = PinRound | SliderRound`, discriminated by `kind` (`lib/games.ts`).
- `GameDef.type` (`'pin' | 'slider' | 'battleship' | 'soon'`) drives lobby navigation and
  route selection.
- The Battleship page uses a `Phase` union (`'unit' | 'subunit' | 'place' | 'battle' |
  'over'`) to model its flow.

When you narrow, let TypeScript prove exhaustiveness. Prefer adding a variant to a union
over adding another boolean flag.

## Pure core in `lib/`, effects at the edges

Business logic is pure and lives in `lib/` (and content in `data/`); side effects live in
components and the provider.

- Pure: scoring (`lib/games.ts`), reward/streak/level math (`lib/player.tsx` helpers), all
  Battleship board legality and geometry (`lib/battleship.ts`), answer checking
  (`checkAnswer` in `QuestionPanel.tsx`).
- Effects at the boundary: `localStorage` (only in `player.tsx`, only via `finishGame`),
  keyboard listeners (`Game.tsx`), and audio (`lib/sound.ts`, synthesized with the Web
  Audio API — no asset files).

New game rules go in `lib/` as pure functions; React state and effects stay in the page.

## Strict TypeScript, no `any`

`tsconfig.json` runs `strict: true`. There is no `any` in the source — model shapes as
unions and narrow `unknown` rather than casting. Types are treated as documentation that
cannot go stale.

## Terse, single-purpose helpers

The `lib/` style is short pure helpers with intent-revealing names (`shipCells`,
`placementOk`, `rewardsFor`, `levelFromXp`), often one expression each, sometimes with
tiny factory helpers for authoring (`pin`, `sl`, `g`, `s`, `f`). Components follow a
consistent inline-Tailwind style with small local subcomponents (e.g. `Hud`, `Cabinet`,
`Chip` inside `Lobby.tsx`). Comments explain *why*, not *what*. Match this density — do not
introduce speculative abstractions; duplicate twice before extracting.

## The build is the gate (no eslint / test runner / CI yet)

There is no eslint config, no test runner, and no CI in the repo today. (The lone
`eslint-disable` comment in `Game.tsx` is vestigial.) The quality gate is therefore:

```
npm run build      # tsc && vite build — must pass with zero TypeScript errors
```

plus a clean browser console while driving the flow. "Green before commit" means exactly
that.

**Add Vitest for non-trivial pure logic.** If you write or change real pure logic —
scoring curves, streak/reward math, Battleship placement rules — add Vitest coverage rather
than leaving it untested. Those pure functions in `lib/` are precisely the parts worth
covering; test behavior (given input, expected score/legality), not implementation.

## Git and delivery

- Small, focused, imperative-subject commits — one logical change each.
- Do not commit or push unless asked; if on the default branch, branch first.
- Green before commit: `npm run build` passes cleanly.
