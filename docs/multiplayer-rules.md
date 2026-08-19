# Publishing the multiplayer rules

> **Live as of 2026-08-19.** Verified in the console: the deployed ruleset
> carries the `gameRooms` block, the private `hands` block, and the tightened
> "leaving" clause in BOTH room blocks. Ascend tables work; nothing is
> outstanding.

Firestore denies anything its rules don't explicitly name, and there is no
automated rules deploy. This file is the source of truth, but editing it does
nothing by itself — every change has to be pasted into the Firebase console by
hand, using the steps below, before it takes effect.

## Reading what is actually live

Two traps, both hit in practice:

- **The console editor only keeps visible lines in the page**, so the browser's
  Ctrl+F silently misses anything past the first screen and reports "not found"
  for text that is right there. Click INSIDE the editor first so its own search
  runs instead.
- **The end of the file looks identical either way.** Every version ends with the
  `match /{document=**}` catch-all, so seeing it proves nothing. Look at what
  sits above it, or read the version list on the left — the starred entry at the
  top is the deployed ruleset, and selecting it shows exactly what is live.

## Who can do it

Anyone with **Editor** or **Owner** on the Firebase project. Harish has this. If
you want to do it yourself, ask him to add your Google account under
**Project settings → Users and permissions**.

## Steps

1. Open the [Firebase console](https://console.firebase.google.com/) and pick
   the **eclipse-arcade** project.
2. Left sidebar → **Firestore Database** → the **Rules** tab.
3. **Copy the whole editor contents into a scratch file first.** This is the
   rollback: publishing replaces the live rules outright, and the console keeps
   history but it is far quicker to paste back than to hunt for it.
4. Open `firestore.rules` from the repo and copy **the entire file**.
5. Paste it over everything in the console editor.
6. Press **Publish**. It takes a few seconds to take effect.

Paste the whole file rather than just the new block — that keeps the console and
the repo identical, which is the only way to know what is actually live.

## Checking it worked

Two signs, in order:

- The console shows no syntax errors before you publish. It refuses to publish a
  file it cannot parse, so a typo cannot take the arcade down.
- After publishing, hosting an Ascend or Card Game table succeeds instead of
  failing. Until the app code lands, the honest check is just that the rules
  published without complaint.

If something looks wrong, paste the scratch copy from step 3 back and publish
again. Nothing else in the arcade depends on the new block, so reverting it is
safe and immediate.

## What the block allows

Same trust model as the Last Standing tables, which have been running on it:

- Only people at a table, or invited to it, can read it.
- Only the host creates it, invites to it, starts it, or closes it.
- An invited player may take **one** free seat, and only their own.
- A player may remove **themselves** and nobody else.
- Every turn must advance `tick` by exactly one, so a stale client cannot replay
  a turn on top of a newer one.
- `game` is fixed when the table is created — a room cannot change which cabinet
  it belongs to.

### The limit worth knowing

Rules cannot re-run a game engine, so they cannot tell a legitimate move from a
flattering one. A player who tampers with their own client can write a game
state that favours them, within tables they were invited into. This is the same
risk Battleship PvP and Last Standing already carry, and it is accepted for a
prototype among friends. Closing it properly would mean running the turn logic
on a server, which is a much larger change than these rules.

## Why one collection for several games

`gameRooms` is the Last Standing table shape plus a `game` field naming which
cabinet the table is for. That is what lets one invite, one lobby, and one rule
block serve Ascend and the Card Game together — and lets a future turn-based
game join by adding a value to a list rather than another rule block and another
publish. Racer is not on this list: it is real-time rather than turn-based and
needs a different design.
