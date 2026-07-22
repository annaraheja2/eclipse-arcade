# Adding a game

There are two shapes a new cabinet can take: one that runs on the **generic pin/slider
loop** (cheapest — no new route or page), or a **bespoke screen** like Battleship. The
`/add-game` skill wires either end-to-end so nothing is left half-connected; the manual
steps are below.

## 1. Register the game — `src/lib/games.ts`

Add a `GameDef` to the `GAMES` array:

```ts
interface GameDef {
  key: string   // unique, URL-safe; also the localStorage bests key and the ICON map key
  name: string  // display name on the cabinet
  color: string // accent hex; themes the cabinet glow, board, and FIRE button
  type: 'pin' | 'slider' | 'battleship' | 'soon'
  rounds: Round[]
}
```

- **`key`** must be unique. It appears in the route (`/play/:key`), as the `bests` key in
  player state, and as the lookup key in the Lobby `ICON` map — keep it stable, since
  changing it orphans existing best scores in `localStorage`.
- **`color`** is the per-game accent. Prefer a token from the `neon` palette
  (see [design-system.md](./design-system.md#neon-palette)).
- **`type: 'soon'`** renders a disabled "coming soon" cabinet with a SOON badge and **no
  route** — use it to stub a planned game. Give it `rounds: []`.

## 2. Give it an icon — `src/pages/Lobby.tsx`

Add an entry to the `ICON` map keyed by the game's `key`, using an SVG component from
`src/icons.tsx`:

```ts
const ICON: Record<string, ReactNode> = {
  // ...
  yourkey: <YourIcon />,
}
```

If no existing icon fits, add a new hand-drawn line icon to `icons.tsx` first (match the
shared stroke style; no emoji — see [design-system.md](./design-system.md#iconography-and-the-no-emoji-rule)).

## 3a. Generic pin/slider game (the easy path)

If your game uses the flat pin or slider mechanic, set `type: 'pin'` or `type: 'slider'`
and provide a `rounds` array (see [content-authoring.md](./content-authoring.md#model-a--flat-rounds-srclibgamests)).
That is it — the Lobby's `Cabinet` navigates to `/play/:key`, and `pages/Game.tsx` renders
the whole session (5 random rounds, aim, FIRE, scoring, rewards) automatically. No new
route, no new page.

## 3b. Bespoke game (like Battleship)

If the game needs its own screen and rules:

1. Build the page under `src/pages/` and any pure logic under `src/lib/` (keep rules pure,
   effects in the page — see [conventions.md](./conventions.md)).
2. Add a `<Route>` in `src/App.tsx` for its path.
3. Branch the Lobby's navigation. In `Cabinet` (in `Lobby.tsx`), the click handler already
   special-cases Battleship:

   ```ts
   navigate(g.type === 'battleship' ? '/battleship' : `/play/${g.key}`)
   ```

   Extend this so your new `type` routes to its own path.
4. Call `finishGame(key, score)` from the page when a session ends — that is the only
   sanctioned way to award XP/coins/streak and record a best.

## Checklist

- [ ] `GameDef` added to `GAMES` with a unique `key`, accent `color`, and correct `type`.
- [ ] Icon wired in the Lobby `ICON` map (new SVG in `icons.tsx` if needed).
- [ ] Content authored (flat `rounds`, or curriculum questions for a bespoke curriculum
      game).
- [ ] For a bespoke game: `<Route>` added and Lobby navigation branched.
- [ ] Session end calls `finishGame` — no direct `localStorage` writes.
- [ ] `npm run build` passes with zero TypeScript errors, and the flow works in the browser.
