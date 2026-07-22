# Content authoring

There are two content models (see [architecture.md](./architecture.md#the-two-content-models-know-which-one-you-are-extending)).
Author into the one the target route already uses; do not cross-wire them. The `/add-content`
skill automates authoring into the correct model with sane scoring and difficulty — reach
for it when adding questions or rounds.

## Model A — flat rounds (`src/lib/games.ts`)

Used by the generic `/play/:gameKey` loop (**PinPoint**, **Slider**). A `Round` is a
discriminated union on `kind`. Two small factory helpers keep authoring terse:

```ts
// pin(prompt, x, y, range = 10)  -> PinRound
pin('Plot the point  (−3, 2)', -3, 2)

// sl(prompt, answer, min, max, step = 0.5) -> SliderRound
sl('Solve:  2x + 4 = 10', 3, -5, 15)
```

- **PinRound** — the player places a point on a coordinate grid. `x`/`y` are the correct
  coordinates; `range` sets the grid extent (`-range..range` on both axes) and, through the
  scorer, how forgiving the round is. The player's aim snaps to half-units.
- **SliderRound** — the player drags a marker along a number line. `answer` is correct;
  `min`/`max` bound the line; `step` is the snap granularity.

To add rounds, append to the `PINPOINT_ROUNDS` or `SLIDER_ROUNDS` arrays. Each session
draws 5 random rounds from the game's pool (`pickRounds`), so keep at least ~5 per game and
add more for variety. The current sample sets are placeholders ("replace with team-authored
questions later").

### Scoring guidance (flat model)

Both scorers decay exponentially from the correct answer toward `ROUND_MAX = 1000`
(see [architecture.md](./architecture.md#scoring--srclibgamests)):

- **Pin:** the decay scale is `range / 5`. A larger `range` makes a given absolute miss
  cheaper — a wide board is more forgiving. Keep `range` proportional to how precise you
  want players to be.
- **Slider:** the decay scale is `(max - min) / 30`. A wider `[min, max]` span makes a
  given absolute miss cheaper. Size the span so the answer sits comfortably inside it with
  room on both sides, and set `step` fine enough that the exact answer is reachable.

## Model B — curriculum questions (`src/data/subjects.ts`)

Used by **Battleship**. Content nests `Course -> Unit -> Subunit -> Question`.
`difficulty` (`easy | medium | hard`) and `type` (`graph | slider | fill`) live on the
**Subunit** — every question in a subunit shares them. Three factory helpers:

```ts
// g(prompt, x, y, range = 8)               -> graph Question
g('Plot the point  (3, 2)', 3, 2)

// s(prompt, answer, min, max, step = 0.5)  -> slider Question
s('Solve:  x + 5 = 12', 7, 0, 20)

// f(prompt, fill)                          -> fill Question
f('The number multiplying a variable is the ______.', 'coefficient')
```

- **graph** — rendered with `PinBoard`; correct when the placed point is within 0.5 of
  `x` and `y` on each axis.
- **slider** — rendered with `SliderBoard`; correct when within one `step` of `answer`.
- **fill** — rendered with `FillInput`; correct on a normalized string match
  (trimmed, lowercased, whitespace-collapsed) or a numeric-equality match, so `"0.5"` and
  `".50"` both pass. Answer-checking lives in `checkAnswer` (`components/QuestionPanel.tsx`).

To add curriculum content, add a `Question` to a subunit's `questions`, a new `Subunit`
to a unit, a new `Unit` to a course, or a new `Course` to `COURSES`. Note Battleship
currently always uses `COURSES[0]` (Algebra 1) — additional courses are authored but not
yet surfaced in a picker.

### Difficulty guidance (curriculum model)

Set `difficulty` to match the cognitive load, and keep it consistent within a subunit. It
is metadata today (surfaced in the Battleship unit/subunit picker) rather than a scoring
multiplier — Battleship rewards are a fixed 3000 for a win / 500 for a loss regardless of
difficulty. Author `min`/`max`/`step` for slider questions and `range` for graph questions
using the same forgiveness reasoning as the flat model above.
