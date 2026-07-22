# Product Research — Top 5 High-Leverage, Easy-to-Build Additions

> Research snapshot: 2026-07-21. Produced by the `product-researcher` agent, grounded in a
> full read of the codebase. Findings age — treat this as a point-in-time snapshot, not a
> living spec. Ranked by **impact x ease**; all items are buildable in <= a day within the
> no-backend / localStorage constraint.

Grounded in a read of `lib/games.ts`, `lib/player.tsx`, `lib/sound.ts`, `pages/Lobby.tsx`,
`pages/Game.tsx`, `pages/Battleship.tsx`, and `data/subjects.ts`.

---

## 1. Activate the Daily Challenge (the stub already exists) + make the streak mean something

**Lever: retention (the single biggest one).**

**What it is.** There is already a `daily` cabinet in `GAMES` (`lib/games.ts:48`) sitting as
`type: 'soon'`, and `Lobby.tsx:129` even has a *dead* render path — `g.key === 'daily' && !soon`
— that draws a "DAILY" badge but can never fire because the game is disabled. Meanwhile
`player.tsx:52-55` already computes a **calendar-day streak** (`lastPlayed`, increments once/day,
resets on a skip) — but nothing in the product drives a daily return, so the streak is a number
that only ever reads 0 or 1 for most users. This is a fully-scaffolded door left half-open.

Build a Daily Challenge: one deterministic set of rounds per calendar date (seed a shuffle by
`today()`, drawn from the existing `PINPOINT_ROUNDS` / `SLIDER_ROUNDS` pools), playable once/day,
with a localStorage `daily:<date>` "completed" marker. The streak becomes the reward for showing up.

**Evidence.** Daily-return mechanics are the highest-ROI retention tool in this genre. Duolingo
reports users who hold a 7-day streak are **3.6x more likely to stay engaged long-term**, streaks
lift commitment ~60%, and separating streak tracking as its own goal produced a measurable Day-14
retention bump ([deconstructoroffun](https://duolingo.deconstructoroffun.com/mechanics/streaks),
[orizon.co](https://www.orizon.co/blog/duolingos-gamification-secrets),
[trophy.so](https://trophy.so/blog/duolingo-gamification-case-study)). Wordle's *one-puzzle-per-day,
same for everyone* structure is what made results comparable and social
([slate](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html)).

**Ease (which files).** `lib/games.ts`: flip `daily` off `soon`. A small `pickDailyRounds(date)`
pure helper (seeded shuffle — reuse the Fisher-Yates already in `pickRounds`). Route it through the
existing `Game.tsx` loop (or a thin wrapper) plus a localStorage played-today gate. `Lobby.tsx`: the
DAILY-badge path already exists; add a "done today / play" state. **~2 files, one new pure function.**
No new content authoring — it reuses existing pools. **Effort: S-M.**

**Risk/constraint.** localStorage-only means the streak is per-device and clearable — acceptable for
a prototype. Keep the daily-seed logic pure and unit-test it (per the repo's Vitest guidance for
reward/streak math).

---

## 2. Surface the streak (it's currently invisible on mobile) + an at-risk nudge

**Lever: retention — near-zero effort, compounds #1.**

**What it is.** The streak is computed but **buried**: it appears only in the HUD chip inside a
`hidden md:flex` container (`Lobby.tsx:52`), so on phones — where these games get played — the streak
is completely invisible. There's no celebration on increment and no "keep your streak" prompt. Surface
it in the `Hero` (`Lobby.tsx:94`) with a loss-aversion framing ("Play today to keep your 5-day streak")
and a small flame count that's visible at every breakpoint.

**Evidence.** Duolingo's streak works specifically through **loss aversion made visible** — the count
is shown "prominently throughout the app," and prominence + milestone celebration + reminders are cited
as the reason daily return "feels both achievable and valuable"
([justanotherpm](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature),
[darewell.co](https://darewell.co/en/duolingo-streaks-retention-secret/)). A streak the user can't see
can't create loss aversion.

**Ease.** `Lobby.tsx` only (Hero + maybe un-hiding the streak chip); optionally a one-line
`isStreakAtRisk(lastPlayed)` helper in `player.tsx`. **~1 file. Effort: S.**

**Risk/constraint.** None structural. Watch AA contrast of any new streak text on `#0a0620` (the repo's
stated real risk) — don't rely on glow for legibility.

---

## 3. Wordle-style "share your score" card on the Results screen

**Lever: virality — the only zero-backend growth engine available.**

**What it is.** There is **no sharing anywhere**. The `Results` component (`Game.tsx:145`) ends at
Replay / Arcade; Battleship's `over` screen (`Battleship.tsx:223`) likewise. Add a SHARE button that
builds a spoiler-free text card — a row of colored blocks per round keyed off the existing per-round
`pts[]` (e.g. green >=780 / accent >=400 / orange below, mirroring the color logic already at
`Game.tsx:167`) plus the total and a level tag — and copies it via the Web Share API with a clipboard
fallback.

**Evidence.** Wordle grew from ~90 to ~3 million players in two months with **no ads and no marketing
budget**, driven almost entirely by the shareable emoji grid; the key design property was that the grid
**shows your result without spoiling the answer** ([webflow](https://webflow.com/blog/wordle-design),
[buzzfeednews](https://www.buzzfeednews.com/article/stefficao/how-wordle-went-viral-strategy),
[dinogame.gg](https://dinogame.gg/blog/history-of-wordle/)). A per-round block grid of scores is exactly
that spoiler-free, comparable artifact — and it pairs naturally with the Daily Challenge (#1), since a
shared daily card is the same puzzle everyone played.

**Ease.** A pure `buildShareCard(pts, total, gameName)` helper + a button in `Results` (and optionally
Battleship's over-screen). Web Share API / `navigator.clipboard` are browser built-ins — no dependency,
no backend, static-host-safe. **~1-2 files. Effort: S.**

**Risk/constraint.** Web Share API is best on mobile; desktop needs the clipboard fallback (handle the
promise rejection — no silent catch, per standards). No URL is generated, which is fine and even
on-brand (Wordle shared no link either).

---

## 4. Give the generic Game loop the juice Battleship already has (sound is built and unused)

**Lever: engagement / game-feel — trivial reuse, currently dead value.**

**What it is.** `lib/sound.ts` exports a full synth SFX kit — `sfxFire`, `sfxHit`, `sfxMiss`, `sfxSink`,
`sfxWin`, `setMuted`, `isMuted` — but **`Game.tsx` imports none of it** (confirmed: zero `sfx`/`sound`
references). PinPoint and Slider — the two actually-playable generic games — are completely silent, while
Battleship is fully juiced. Wire `sfxFire()` on FIRE/submit, `sfxHit`/`sfxMiss` on reveal (branch on the
>=500 threshold already computed for `mood`), and `sfxWin()` on the Results screen, plus reuse the
existing mute toggle pattern.

**Evidence.** Juice (sound + small feedback effects) is described as one of the **most cost-effective**
ways for a small team to raise perceived quality, and satisfying feedback directly "reduces the likelihood
of [players] abandoning your game"; audio specifically is called an "affordable way to improve feedback
rapidly" that indies under-invest in
([wayline](https://www.wayline.io/blog/the-juice-problem-how-exaggerated-feedback-is-harming-game-design),
[gameanalytics](https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design)).

**Ease.** `Game.tsx` only — a handful of call sites at existing event points (`submit`, reveal effect,
results). Zero new code in `lib/`. **~1 file. Effort: S (near-trivial).**

**Risk/constraint.** Respect the existing `isMuted()` state so it's not intrusive; gate the first
AudioContext resume on a user gesture (the FIRE press already is one). Keep audio at the boundary — don't
leak it into the pure scorers.

---

## 5. Elaborated feedback (a one-line "why") after each round

**Lever: learning outcomes — the differentiator vs. a pure arcade.**

**What it is.** On reveal, the game shows only the raw answer — `Answer: (2, -1)` / `Answer: 4`
(`Game.tsx:123`); Battleship's `QuestionPanel` similarly verifies right/wrong with no explanation. That's
*verification-only* feedback. Add an optional `explain?: string` to `Round` (`lib/games.ts`) and `Question`
(`data/subjects.ts`) and render it in the reveal panel and QuestionPanel when present. Optional field means
no forced re-authoring; add explanations to a handful of rounds first.

**Evidence.** The formative-feedback literature is consistent: feedback with **both verification and
elaboration** (why the answer is right / why yours was wrong) produces better learning than verification
alone, and students given explanations outperform those shown only the answer — while the *simplest*
elaboration is often the most efficient, so a single line is the right dose
([Shute, ETS formative-feedback review](https://myweb.fsu.edu/vshute/pdf/shute%202007_f.pdf),
[Mertens 2025, JCAL](https://onlinelibrary.wiley.com/doi/10.1111/jcal.13112?af=R),
[Age of Learning](https://www.ageoflearning.com/beyond-fun-how-game-based-learning-creates-durable-outcomes/)).
This is what lets Eclipse Arcade credibly claim "learning," not just "math-flavored aiming."

**Ease.** Add one optional field to two type definitions (both models — this respects the two-content-model
boundary rather than fighting it), render it in `Game.tsx`'s reveal block and `QuestionPanel`, author a few
strings. **~3 files, mostly content. Effort: S-M** (scales with how much content you write; the code is small).

**Risk/constraint.** The two content models mean you add the field twice — acceptable and intentionally *not*
a cross-wire. Bounded by content-authoring appetite; ship it on 5-10 rounds first to prove the surface.

---

## Quick wins (paper cuts spotted along the way)

- **Emoji on web violates the design system.** `Battleship.tsx:140` uses mute-button emoji and `:211` uses a
  target emoji in "Tap the enemy waters to fire!" — CLAUDE.md is explicit: **no emojis on web**, use the
  hand-drawn SVG line icons in `icons.tsx`. Swap for icon components. (The share-card blocks in #3 should be
  Unicode geometric squares in *shared text*, which is fine — that's outbound content, not web UI.)
- **Dead/decorative HUD controls.** The Lobby header's Search field (`Lobby.tsx:47`), Users, Bell-with-dot,
  and Profile buttons are non-functional chrome. Either wire the search to filter `GAMES` (trivial, and pairs
  with a growing catalog) or remove them — decorative unlabeled controls are also an a11y liability.
- **Dead DAILY-badge branch** at `Lobby.tsx:129` is unreachable while `daily` is `soon` — it gets resurrected
  for free by opportunity #1; otherwise it's dead code.
- **Vestigial `eslint-disable`** at `Game.tsx:45` (repo notes no eslint runs) — remove it.
- **4 of 7 cabinets are dead `soon` stubs** (`daily`, `gridfill`, `matchup`, `fitline`). Beyond #1, that's a
  lot of grey space; consider hiding `soon` cabinets below a fold or converting one flat variant, but a *new*
  game is more than a day (see rejected).

## Explicitly rejected (don't re-explore)

- **Global/online leaderboard, multiplayer, friends, accounts** — every one needs a backend; the app is
  localStorage-only on static hosting. A *local* best-score list is redundant with existing `bests`.
- **Push notifications / streak reminders** — no server, no installed-app/PWA notification infra; can't deliver.
- **Unifying the two content models** — CLAUDE.md flags this as deliberate structural debt and "a refactor to
  plan, not a drive-by." High risk, not a day's work, and none of the top 5 require it.
- **Building a brand-new game from scratch** (Grid-Fill / Match-Up) to fill the `soon` cabinets — real value
  but > 1 day and higher risk than surfacing mechanics that already exist; hand to `/add-game` when there's
  appetite.
- **PWA / offline install** — plausible later, but not a probability-of-success lever for a prototype and not
  "easy given current stack" without config + icon work.

## Bottom line

The two highest-leverage moves both *finish doors the codebase already left open* — activating the `daily`
stub against the already-computed streak (#1), and surfacing that streak where users can actually see it (#2)
— followed by a zero-backend viral share card (#3), free reuse of the built-but-unused SFX kit (#4), and
one-line explanations that make "learning" real (#5).

## Sources

- https://duolingo.deconstructoroffun.com/mechanics/streaks
- https://www.orizon.co/blog/duolingos-gamification-secrets
- https://trophy.so/blog/duolingo-gamification-case-study
- https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature
- https://darewell.co/en/duolingo-streaks-retention-secret/
- https://webflow.com/blog/wordle-design
- https://www.buzzfeednews.com/article/stefficao/how-wordle-went-viral-strategy
- https://dinogame.gg/blog/history-of-wordle/
- https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html
- https://myweb.fsu.edu/vshute/pdf/shute%202007_f.pdf
- https://onlinelibrary.wiley.com/doi/10.1111/jcal.13112?af=R
- https://www.ageoflearning.com/beyond-fun-how-game-based-learning-creates-durable-outcomes/
- https://www.wayline.io/blog/the-juice-problem-how-exaggerated-feedback-is-harming-game-design
- https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design
