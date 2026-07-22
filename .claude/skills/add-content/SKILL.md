---
name: add-content
description: Author new rounds or questions into Eclipse Arcade's correct content model with sane scoring/difficulty. Use when the user asks to add questions, rounds, problems, a unit, or curriculum content to the eclipse-arcade project (as opposed to a whole new game).
---

# add-content — author into the right model

Two content models exist; putting content in the wrong one silently does nothing. Pick by
the route that will serve it (see repo `CLAUDE.md`).

## Model A — flat rounds (`lib/games.ts`) → the generic `/play/:gameKey` loop
Used by PinPoint (`pin`) and Slider (`slider`). Add to the game's round array:
- **Pin:** `pin(prompt, x, y, range?)` — target coordinate `(x, y)`; `range` (default 10) is
  the board's half-extent AND the scoring tolerance. Smaller range = tighter scoring.
- **Slider:** `sl(prompt, answer, min, max, step?)` — pick `min/max` so `answer` sits
  comfortably inside, not at an edge; `step` (default 0.5) is the increment.
- Scoring is exponential decay (`ROUND_MAX = 1000`), so a close guess still pays — keep
  `range`/`(max-min)` proportional to how precise the answer should be.

## Model B — curriculum (`data/subjects.ts`) → Battleship
Structure is `Course → Unit → Subunit → Question`. **Difficulty and answer-type live on the
Subunit.** Use the helpers: `g(prompt, x, y, range?)` graph, `s(prompt, answer, min, max, step?)`
slider, `f(prompt, fill)` fill-in. To add:
- New questions → push into an existing `Subunit.questions`.
- New topic → add a `Subunit` (`id`, `name`, `difficulty: easy|medium|hard`, `type: graph|slider|fill`,
  `questions`), or a `Unit`/`Course` above it. Keep `type` consistent with every question in that subunit.

## Conventions
- Prompts use the app's math notation style already present (e.g. `y = 2x + 3`, `−` minus,
  `²` superscript). No emojis. Match the terse tone of the existing samples.
- Keep answers unambiguous and within the stated range/bounds.

## Verify
`export PATH="/Users/annaraheja/.local/node/bin:$PATH" && npm run build`, then play the
affected game/subunit in `npm run dev` (:5174) and confirm the new items appear and score
correctly. Report what you observed.
