# Eclipse Arcade — Session Handoff (2026-07-22)

Quick-start context for the next session. Deep detail lives in git history + the
root `CLAUDE.md`; this is the "where are we / what's next" map.

## Three environments, kept in sync
- **localhost:5174** (dev): `export PATH="/Users/annaraheja/.local/node/bin:$PATH" && npm run dev`
- **GitHub `main`** (github.com/annaraheja2/eclipse-arcade) — mirrors localhost.
- **Preview site**: https://annaraheja2.github.io/eclipse-arcade/ — mirrors `main`.

**Delivery policy** (see CLAUDE.md → "Deploy & delivery"): push finished green work to
`main` automatically; **deploy to the preview after each push** (`npx gh-pages -d dist`;
`rm -rf node_modules/.cache/gh-pages` first if it errors; ~1–5 min CDN lag). This is a
**collaborative private preview, NOT a public launch** — the URL is just unshared. Do **not**
announce / "go live" without an explicit ask.

## Backend (Firebase)
- **SHARED project `eclipse-learning-97944`** (also backs sibling Eclipse Learning). Web
  config is in gitignored `.env.local` (publishable, not secret). Auth: Google + Email/Password.
- **Rules = repo `firestore.rules`** and cover BOTH apps. **Rules are NOT auto-deployed** —
  every rules change needs a manual publish: `pbcopy < firestore.rules` → Firestore → Rules
  → Cmd+A → Cmd+V → Publish. Currently-published rules are up to date as of this session.
- Arcade admins: `annaraheja2@gmail.com`, `alexleyvalp@gmail.com`.

## Shipped this session (all on `main` + preview)
- Neon lobby glow-up (marquee, cabinet tiles, per-game animated thumbnails).
- **Battleship**: gray molded-plastic ships, fluid drag/rotate, vs-AI + live PvP; pick
  course/unit/subunit first; **same-difficulty quick-match** + friend invites carry the topic.
- **Accounts**: Google + email/password, cloud-synced player state, **set-a-password**
  (link email/pw to a Google account), password reset, delete/export.
- **Usernames** (unique, server-reserved). **Friends** + **quick-match**.
- **Settings/Profile tab** (⚙ top-right of lobby): stats dashboard, default course, avatar
  color, persistent sound + reduce-motion toggles, data/privacy.
- **Admin content editor** (`/admin`): 4 courses (Algebra 1, Geometry, Algebra 2,
  Precalculus), add/edit/reorder units + subunits + questions, calm Eclipse-Learning theme,
  **"Reset to bundled"** recovery button.
- Removed the Slider cabinet.
- **Racer** (NEW — solo Phase 1): pick a course + up to **4 topics** → 3-min race vs 3 AI
  cars; correct +2 / wrong −2 MPH (floor 0, cap 30), cars auto-cruise; always-visible
  standings bar; bold white question card over the neon track; finish-line animation. Client-only.

## Open items / next steps
1. **RESOLVED** — the Racer white-card AA/keyboard bugs the guardian found are fixed: the
   fill/graph/slider answer inputs now render dark-on-light on the white card, and a dark
   `:focus-visible` ring (`.qp-light`) is scoped to the light surface (gated behind a `light`
   prop; Battleship's dark path is byte-identical). *Remaining follow-up:* PinBoard/SliderBoard
   SVGs are not keyboard-operable (no tabindex/arrow keys) — a shared-component change that
   also affects Battleship; deliberately deferred.
2. **Racer Phase 2** (queued): 2–5 player **online race rooms** — lobby (create/join/start),
   realtime speed sync (write each car's *speed* on answer, integrate client-side; don't spam
   per-frame), same-difficulty matching. Client-authoritative-for-own-car trust model, like Battleship.
3. **Optional security tweak** (flagged, non-blocking): in the quick-match `placing` rule, bind
   each player's `sel.difficulty` to their own queue doc so a hacked creator can't stick an
   opponent with a harder topic. One-line rules change → needs a rules re-publish.
4. **Optional: true CI auto-deploy** — user runs `gh auth refresh -s workflow`, then recreate
   `.github/workflows/deploy.yml` (removed this session because the token lacked `workflow`
   scope; spec is in CLAUDE.md → "Hop 2"). Makes main→preview GitHub-native, covering
   collaborators' own pushes.
5. **Quad Drop** — researched top pick for the next game (Connect-Four-style "align four"
   duel, original name/art, answer-to-drop math gate; smallest strong AI; easy future PvP).
   Not built. Runner-ups: Dots-and-Boxes, Reversi, Memory-Match (fills the `matchup` cabinet).
6. **Content authoring**: Geometry/Algebra 2/Precalculus units are empty scaffolds — author
   subunits + questions via `/admin` (SEED FROM BUNDLED per course first). Algebra 1 is
   restorable via **Reset to bundled**.
7. **`soon` cabinets** remaining: Grid-Fill, Fit-the-Line (research suggests dropping
   Fit-the-Line — another thin aim mechanic, the category we're moving away from).

## Gate & tooling
- Quality gate: `npm run build` (tsc + vite, zero errors) **and** `npm test` (Vitest). Node:
  `export PATH="/Users/annaraheja/.local/node/bin:$PATH"`.
- Purpose-built agents: `arcade-builder` (features), `game-craft` (Fable — game-feel/UI/art),
  `tier1-reviewer`, `eclipse-web-guardian`, `run-verify`, `product-researcher`.
- Pattern that worked well: build in a subagent → adversarial review (tier1 + guardian) →
  fix-forward → auto push+deploy. Security-sensitive rules changes got two adversarial passes.
