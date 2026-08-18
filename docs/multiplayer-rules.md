# Publishing the multiplayer rules

> **Republish needed (2026-08-18).** Both room blocks were tightened: the
> "leaving" clause allowed anyone merely INVITED to submit `members: []` and
> empty a whole lobby, because an empty list is a subset that trivially
> excludes them. Leaving now requires the member list to shrink by exactly one,
> and declining an invite is its own clause that cannot touch the seated
> players. Until this is republished the hole is live.

Firestore denies anything its rules don't explicitly name. Ascend and the Card
Game will use a `gameRooms` collection, and until the rule block for it is live
in the Firebase console **every read and write to it fails** — the games stay
solo no matter what the app code does.

The block is already written and version-controlled in `firestore.rules`. It has
to be published by hand, once. That is the whole task.

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
