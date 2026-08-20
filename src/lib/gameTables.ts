// What it takes to seat somebody at a shared table, per cabinet.
//
// `gameRooms` is one document shape for every turn-based game (lib/gameroom.ts),
// but two things still differ per game: how many chairs there are, and what the
// opening `state` looks like when the table re-seats. Those two facts used to be
// written out at each call site — the lobby knew them, and the invite path did
// not, which is how accepting a Card Game invite ended up throwing and a Racer
// invite ended up navigating without taking a seat at all.
//
// So they live here once, keyed by GameKind. A new turn-based cabinet joins the
// invite system by adding a row to TABLE_RULES; every surface that seats a
// player — the lobby, the Friends list, the pop-up that finds you mid-game —
// reads the same row.
import { createAscendState, ascendStateData, MAX_SEATS as ASCEND_SEATS } from './ascendRoom'
import { openingPublic, cardPublicData } from './cardRoom'
import { PLAYER_MAX as CARD_SEATS } from './cardgame'
import { MAX_SEATS as RACER_SEATS } from './racerRoom'
import type { GameKind, GameRoom } from './gameroom'

export interface TableRules {
  /** Chairs at this game's table. Capped again by ROOM_MAX_SEATS. */
  maxSeats: number
  /**
   * The shared state a table of `seatCount` opens on. `room` is the table as it
   * stands, because some games need something from it — the Card Game deals its
   * opening pile from the room's seed, so every client derives the same one.
   */
  seatState: (seatCount: number, room: GameRoom) => Record<string, unknown>
}

export const TABLE_RULES: Record<GameKind, TableRules> = {
  ascend: {
    maxSeats: ASCEND_SEATS,
    seatState: (seats) => ascendStateData(createAscendState(seats)),
  },
  cardgame: {
    maxSeats: CARD_SEATS,
    // Hand SIZES and the face-up pile only — the cards themselves live in the
    // per-player `hands` documents nobody else may read.
    seatState: (seats, room) => cardPublicData(openingPublic(room.seed, seats)),
  },
  racer: {
    maxSeats: RACER_SEATS,
    // A racer's position lives in their own document under the room, so the
    // shared state is unused; an empty object matches what creating one writes.
    seatState: () => ({}),
  },
}

export const tableRules = (game: GameKind): TableRules => TABLE_RULES[game]
