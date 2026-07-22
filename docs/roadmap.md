# Roadmap and current status

This is an honest snapshot of the prototype as it stands, derived from the code and the
project's `CLAUDE.md`. It is not aspirational marketing — it is what exists today.

## Version: `0.1.0` prototype

Everything is client-side. No backend, no accounts, no server — all progress persists to
`localStorage` under `eclipse-arcade:player`. Sample content throughout is placeholder,
explicitly marked "replace with team-authored questions later"; real content is expected to
land in the curriculum model.

## Cabinets: live vs. stubbed

From the `GAMES` registry in `src/lib/games.ts`:

| Cabinet | `key` | Accent | `type` | Status |
|---------|-------|--------|--------|--------|
| Battleship | `battleship` | cyan `#3df5ff` | `battleship` | **Live** — bespoke screen, `/battleship` |
| PinPoint | `pinpoint` | purple `#a24bff` | `pin` | **Live** — generic loop, `/play/pinpoint` |
| Slider | `slider` | amber `#ffb43d` | `slider` | **Live** — generic loop, `/play/slider` |
| Daily Challenge | `daily` | amber `#ffb43d` | `soon` | Stub — "coming soon", no route |
| Grid-Fill | `gridfill` | green `#3dffa2` | `soon` | Stub — "coming soon", no route |
| Match-Up | `matchup` | pink `#ff4d8d` | `soon` | Stub — "coming soon", no route |
| Fit-the-Line | `fitline` | orange `#ff6b3d` | `soon` | Stub — "coming soon", no route |

Three cabinets are playable; four are `type: 'soon'` placeholders that render a disabled
cabinet with a SOON badge and no route.

## Known structural debt

- **Two content models coexist and are not unified** — the flat `GameDef`/`Round` model
  (`lib/games.ts`, driving PinPoint/Slider) and the curriculum `Course -> Unit -> Subunit
  -> Question` model (`data/subjects.ts`, wired only into Battleship). This is the main
  structural debt. They should not be cross-wired; converging them would be a deliberate
  refactor. See [architecture.md](./architecture.md#the-two-content-models-know-which-one-you-are-extending).
- **No persisted-state migration.** `load()` shallow-merges stored state over a default, so
  new `PlayerState` fields are safe to add — but renaming or repurposing an existing field
  would silently break existing saves. A migration step is needed before any breaking shape
  change.
- **Battleship is single-course today.** It always uses `COURSES[0]` (Algebra 1); the data
  supports more courses, but there is no course picker yet.
- **Battleship placement UX is in active development** — the pure board rules are stable;
  the on-screen select/move/rotate interaction is being iterated.

## Tooling gaps

- **No test runner.** Vitest is expected for new pure logic but is not set up yet.
- **No eslint, no CI.** The quality gate is `npm run build` passing plus a clean console.
- **No deploy automation.** The remote is `github.com/annaraheja2/eclipse-arcade`; the
  hosting / Pages workflow is TBD. The static bundle is already deploy-ready for any static
  host thanks to `HashRouter` and `base: './'` (see
  [architecture.md](./architecture.md#why-hashrouter--base-)).

## Natural next steps

These follow from the state above (not a committed plan):

- Flesh out one or more `soon` cabinets into real games.
- Replace placeholder sample content with authored questions in the curriculum model.
- Add Vitest coverage for the pure scoring, reward/streak, and placement logic.
- Add a persisted-state migration path before changing the `PlayerState` shape.
- Stand up the deploy workflow for the target static host.
