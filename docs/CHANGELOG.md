# Changelog

All notable changes to Eclipse Arcade are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/).

This history is summarized from the git log. Nothing has been tagged or released yet;
everything to date is the initial `0.1.0` prototype build, still in progress.

## [Unreleased] — 0.1.0 prototype

### Added

- **Arcade shell and lobby.** Neon-on-dark home prototype: the HUD (coins, streak, level
  bar, profile), the hero wordmark, and the cabinet grid rendered from the `GAMES`
  registry, with taller art-area cabinets and a roomier top bar.
- **Playable core loop.** Hash-based routing plus two generic games — PinPoint (place a
  point on a coordinate grid) and Slider (drag a marker on a number line) — running the
  shared 5-round session with exponential-decay scoring.
- **Progression and persistence.** XP, coins, and daily streaks awarded on finishing a
  game and persisted to `localStorage`, with a per-game best score and a level derived from
  XP.
- **Game feel.** On-screen D-pad controller and a targeting crosshair, full keyboard
  controls (arrows to aim, Space/Enter to fire and advance), and a neon avatar bot that
  reacts to how you are doing.
- **Battleship (Phase 1).** A bespoke 8×8 game versus an AI: unit/subunit selection from
  the curriculum content, manual fleet placement under the classic "no ships touch" rule
  (adjacency including diagonals blocked), solve-a-question-to-earn-a-shot gating, and
  hit / miss / sink resolution with win detection.
- **Immersive Battleship presentation.** An animated ocean with flowing wave layers and
  bobbing SVG warships, shell/impact effects (fire and smoke on a hit, splash on a miss),
  and synthesized Web Audio sound effects with a mute toggle.

### Changed

- **Battleship look and placement iteration.** Moved to an open-water look (flowing wave
  lines, bobbing ships), then restored a legible grid with visible cells and A–H / 1–8
  coordinate labels over the ocean. Placement flow was reworked so all five ships start
  pre-placed and the player rearranges them (tap to select, tap water to move, ROTATE to
  turn the selected ship). This UX is still being actively improved.

### Fixed

- **Fleet placement clicks.** The animated wave overlay was intercepting pointer events and
  blocking placement; made it `pointer-events: none` so the board is interactive again.

### Notes

- No release has been tagged. There is no CI, test runner, or deploy automation yet; the
  quality gate is `npm run build` (`tsc && vite build`) passing cleanly.
- Sample content in both content models is placeholder, to be replaced with team-authored
  questions.
