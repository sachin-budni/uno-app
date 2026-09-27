# UNO Arena

A real-time multiplayer UNO-style card game. Create a table, share a six character code, and play
with friends in the browser — with a Node.js game engine that is the single source of truth for
every card, every turn and every rule.

Angular 20 · TypeScript · Tailwind CSS 4 · Socket.IO · Express · JSON Server · **no database**

> UNO Arena is an original, fan-made implementation of a classic shedding-type card game. The card
> artwork, branding and interface are original to this project and are not affiliated with, or
> endorsed by, any commercial card game publisher.

---

## Table of contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Environment variables](#environment-variables)
7. [Running locally](#running-locally)
8. [Running the tests](#running-the-tests)
9. [Building for production](#building-for-production)
10. [Docker](#docker)
11. [API documentation](#api-documentation)
12. [Socket.IO events](#socketio-events)
13. [Game rules](#game-rules)
14. [Project structure](#project-structure)
15. [How the server stays authoritative](#how-the-server-stays-authoritative)
16. [Troubleshooting](#troubleshooting)
17. [Deployment](#deployment)
18. [Known limitations](#known-limitations)
19. [Future enhancements](#future-enhancements)

---

## Features

**Accounts**
- Register, sign in, sign out; passwords hashed with bcrypt and never stored or sent in plain text
- JWT access tokens, route guards, an auth interceptor, and a session that survives a refresh
- Editable profile: username, avatar, and a full career dashboard

**Playing together**
- Create a public or private room with 2–4 seats and one of three rule presets
- Join by six character room code, ready-up system, host-only start
- Quick match queue that pairs the two longest-waiting players
- Live room chat with rate limiting and server-side sanitising
- Reconnect after a refresh, a dropped connection or a closed tab — your hand comes back intact

**The game**
- The published UNO rules, not a simplification: draw one and play it if you can, the Wild Draw
  Four **challenge** (bluff, accept, or call it — wrongly and you draw six), catching a player who
  forgot to call UNO, and a Wild turned up as the starter letting the first player name the colour
- House-rule toggles kept separate from the official set: +2 stacking, an automatic UNO penalty,
  and a simplified "restricted" Wild Draw Four
- Turn timer that acts for a player who runs out of time
- Deck recycling when the draw pile empties
- Winner detection, standard scoring, and a rematch that reseats the same table

**After the game**
- Game history with a per-game move log
- Player statistics: games, wins, losses, win rate, UNO calls, longest streak, cards played
- Leaderboard computed from finished games, filterable by all time / monthly / weekly

**Interface**
- Original card design with corner pips, centre glyphs and Lucide icons for action cards
- Dark game table with motion that carries meaning: a played card flies up from your
  hand or down from the far side of the table so you can see whose it was, the discard
  pile fans out as it grows, the deck thumps on a draw, a seat bumps when that player's
  hand changes, the felt washes with the new colour after a wild, and an outstanding
  +2/+4 pulses until it is answered
- UNO shout, winner confetti, turn-clock urgency colouring
- Responsive from a 360px phone to a wide desktop
- Keyboard navigable, labelled for screen readers, and fully respectful of `prefers-reduced-motion`
- Toasts, loading states and empty states for every asynchronous path

---

## Architecture

```text
                              Browser
                                 │
                        Angular 20 client
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
            HTTP (REST)                   WebSocket (Socket.IO)
                 │                               │
                 ▼                               ▼
             Express                        Socket.IO
                 └───────────────┬───────────────┘
                                 │
                             Node.js
                                 │
                        UNO game engine          ← all rules live here
                                 │
                   Active games (in memory Map)  ← every card, every turn
                                 │
                            JSON Server          ← only on game end
                                 │
                            data/db.json
```

Three processes in development:

| Process     | Port | Responsibility                                       |
| ----------- | ---- | ---------------------------------------------------- |
| Angular     | 4200 | The client. Renders state; never decides rules.      |
| Node API    | 3000 | REST, sockets, the game engine, all validation.      |
| JSON Server | 3001 | Persistence. Never reached from the browser.         |

Two deliberate choices shape everything else:

**Active game state lives in memory.** A `Map<string, GameEngine>` holds every in-flight game.
Individual card movements are never written to `db.json` — only the finished game is, as one
history record plus the players' updated statistics. Writing every move to a JSON file would be
both slow and a corruption risk.

**JSON Server sits behind the Node API.** The browser only ever talks to `/api/*`. Everything that
touches `db.json` goes through [`db.service.ts`](apps/server/src/services/db.service.ts), so
swapping JSON Server for a real database later means rewriting one file and nothing else.

---

## Tech stack

**Client** — Angular 20 (standalone components, signals, new control flow), TypeScript, RxJS,
Reactive Forms, Angular Router with lazy routes, Tailwind CSS 4, `@lucide/angular`, socket.io-client.

**Server** — Node.js, TypeScript, Express 4, Socket.IO 4, jsonwebtoken, bcryptjs, zod,
express-rate-limit, axios.

**Persistence** — JSON Server 0.17 over `data/db.json`.

**Tests** — Vitest (server), Karma + Jasmine (client), plus a scripted end-to-end smoke test.

> `bcryptjs` is used rather than the native `bcrypt` binding: it is the same algorithm in pure
> JavaScript, so `npm install` needs no C++ toolchain on Windows, macOS or Linux.

---

## Prerequisites

- **Node.js 20.19+** (22 LTS or newer recommended) and npm 10+
- A Chromium-based browser for the client test suite (Karma launches Chrome headless)

Nothing else. No database server, no Docker required for local development.

---

## Installation

```bash
git clone <your-repository-url> uno-arena
cd uno-arena
npm install
```

`npm install` installs both workspaces and creates `data/db.json` if it is missing.

Then create your environment file:

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

---

## Environment variables

Everything is optional in development — the defaults in `.env.example` work as-is. The server
**refuses to start** with `NODE_ENV=production` unless `JWT_SECRET` is set to at least 32 characters.

| Variable                             | Default                 | What it does                                        |
| ------------------------------------ | ----------------------- | --------------------------------------------------- |
| `PORT`                               | `3000`                  | Node API port                                       |
| `HOST`                               | `0.0.0.0`               | Interface to bind; `127.0.0.1` keeps it off the LAN |
| `NODE_ENV`                           | `development`           | `production` enables strict secret checking         |
| `JSON_SERVER_URL`                    | `http://127.0.0.1:3001` | Where the persistence layer lives                   |
| `JWT_SECRET`                         | dev-only fallback       | Token signing key. **Set this in production.**      |
| `JWT_EXPIRES_IN`                     | `2h`                    | Access token lifetime                               |
| `CLIENT_URL`                         | `http://localhost:4200` | Allowed CORS origins (comma separated)              |
| `TURN_TIMEOUT_SECONDS`               | `30`                    | Turn clock; `0` disables it                         |
| `MAX_PLAYERS`                        | `4`                     | Upper bound on room size                            |
| `MIN_PLAYERS`                        | `2`                     | Players needed to start                             |
| `INITIAL_HAND_SIZE`                  | `7`                     | Cards dealt to each player                          |
| `RECONNECT_GRACE_SECONDS`            | `60`                    | How long a dropped player keeps their seat          |
| `ALLOW_DRAW_STACKING`                | `false`                 | House rule: let +2 answer +2 instead of drawing      |
| `WILD_DRAW_FOUR_MODE`                | `challenge`             | `challenge` (official) or `restricted`              |
| `TWO_PLAYER_REVERSE_ACTS_AS_SKIP`    | `true`                  | Reverse behaves like Skip in a two-player game      |
| `UNO_PENALTY_CARDS`                  | `2`                     | Cards drawn for forgetting to call UNO              |
| `UNO_AUTO_PENALTY`                   | `false`                 | House rule: penalise a missed UNO without a catch   |
| `RATE_LIMIT_WINDOW_MS`               | `60000`                 | REST rate limit window                              |
| `RATE_LIMIT_MAX`                     | `300`                   | REST requests per window                            |
| `AUTH_RATE_LIMIT_MAX`                | `20`                    | Login/register attempts per window                  |
| `LOG_LEVEL`                          | `info`                  | `debug` · `info` · `warn` · `error`                 |

Precedence, highest first: real environment variables → `apps/server/.env` → `.env` at the repo
root. A `PORT=3010 npm run dev:server` always wins over any file.

---

## Running locally

One command starts all three processes:

```bash
npm run dev
```

| Service     | URL                            |
| ----------- | ------------------------------ |
| Client      | http://localhost:4200          |
| API         | http://localhost:3000/api      |
| Health      | http://localhost:3000/api/health |
| JSON Server | http://localhost:3001          |

**To actually play a game you need two players.** Open `http://localhost:4200` in a normal window
and a second private/incognito window (or a second browser), register a different account in each,
then create a room in one and join with the code in the other.

Individual processes, if you prefer separate terminals:

```bash
npm run dev:json      # JSON Server on 3001
npm run dev:server    # Node API on 3000, restarts on change
npm run dev:web       # Angular dev server on 4200
```

Other useful scripts:

```bash
npm run db:reset      # empty data/db.json (keeps a timestamped backup)
npm run smoke         # end-to-end smoke test against a running stack
npm run typecheck     # type check both workspaces
```

---

## Running the tests

```bash
npm test              # everything: server + client
npm run test:server   # Vitest  - 137 tests
npm run test:web      # Karma   -  55 tests
```

**Server (Vitest, 137 tests)** — deck generation and shuffling, deck recycling, card matching, the
Wild Draw Four restriction, draw stacking, turn order in both directions, Skip, Reverse (including
the two-player case), Draw Two, Wild, colour choice, UNO calls and penalties, win detection,
scoring, turn timeouts, hand privacy, the REST API (registration, login, profiles, rooms, history,
leaderboard) and full Socket.IO integration flows including a game played to a winner, invalid-move
rejection and disconnect/reconnect.

**Client (Karma + Jasmine, 55 tests)** — the card component (faces, labels, disabled and face-down
states), login form validation and error handling, room creation and joining, the game state
service (turn display, card selection, UNO button, colour choice, seat ordering, hand privacy), the
winner screen, and the formatting pipes.

**End-to-end smoke test** — with the stack running (`npm run dev`, or just `dev:json` +
`dev:server`):

```bash
npm run smoke
```

It registers two players, connects two real sockets, creates and joins a room, verifies that an
unauthenticated socket is refused and a forged card id is rejected, plays a complete game to a
winner, then checks that the history, the player statistics and the leaderboard were all written
through to `db.json`. Point it elsewhere with `SMOKE_API=http://127.0.0.1:3010 npm run smoke`.

---

## Building for production

```bash
npm run build         # both workspaces
```

- Client → `apps/web/dist/uno-arena-web/browser` (~123 kB transferred for the initial route;
  every feature is a lazy chunk)
- Server → `apps/server/dist`, started with `npm run start:server`

`npm start` runs the built server together with JSON Server.

---

## Docker

```bash
export JWT_SECRET="a-long-random-string-of-at-least-32-characters"
docker compose up --build
```

Open http://localhost:4200. Three containers come up:

- `json-server` — persistence, with `./data` bind-mounted so games survive a restart
- `server` — the Node API, health-checked at `/api/health`
- `web` — nginx serving the built client and proxying `/api` and `/socket.io` to the server

No PostgreSQL, no Redis, no database container of any kind.

---

## API documentation

Base URL `/api`. Protected routes need `Authorization: Bearer <accessToken>`.
Errors always come back in one shape:

```json
{ "error": { "code": "ROOM_FULL", "message": "That room is already full." } }
```

Validation failures add `details: [{ "field": "email", "message": "..." }]`.

### Auth

| Method | Path             | Auth | Body / notes                                          |
| ------ | ---------------- | ---- | ----------------------------------------------------- |
| `POST` | `/auth/register` | –    | `{ username, email, password, confirmPassword }` → `{ accessToken, user }` |
| `POST` | `/auth/login`    | –    | `{ email, password }` → `{ accessToken, user }`       |
| `GET`  | `/auth/me`       | ✔    | The signed-in player                                  |

### Users

| Method  | Path                  | Auth | Notes                                               |
| ------- | --------------------- | ---- | --------------------------------------------------- |
| `GET`   | `/users/:id`          | –    | Public profile and statistics                       |
| `GET`   | `/users/:id/profile`  | –    | Profile, recent games and the avatar choices        |
| `PATCH` | `/users/:id`          | ✔    | `{ username?, avatar? }` — own profile only         |

### Rooms

| Method  | Path          | Auth | Notes                                                         |
| ------- | ------------- | ---- | ------------------------------------------------------------- |
| `GET`   | `/rooms`      | ✔    | Joinable public rooms                                         |
| `POST`  | `/rooms`      | ✔    | `{ name, maxPlayers, mode, isPrivate }`                       |
| `GET`   | `/rooms/:id`  | ✔    | Accepts a room id **or** a room code                          |
| `PATCH` | `/rooms/:id`  | ✔    | `{ name?, isPrivate? }` — host only, before the game starts   |

### History, leaderboard, health

| Method | Path                | Auth | Notes                                                   |
| ------ | ------------------- | ---- | ------------------------------------------------------- |
| `GET`  | `/game-history`     | ✔    | `?limit=20` — the caller's finished games               |
| `GET`  | `/game-history/:id` | ✔    | One game with its move log; participants only           |
| `GET`  | `/leaderboard`      | –    | `?window=all\|monthly\|weekly&limit=50`                 |
| `GET`  | `/stats/lobby`      | ✔    | Open rooms, active games, queue size                    |
| `GET`  | `/health`           | –    | `200` healthy, `503` if JSON Server is unreachable      |

### Error codes

`VALIDATION_ERROR` · `NOT_AUTHORIZED` · `INVALID_CREDENTIALS` · `EMAIL_TAKEN` · `USERNAME_TAKEN` ·
`USER_NOT_FOUND` · `TOKEN_EXPIRED` · `RATE_LIMITED` · `ROOM_NOT_FOUND` · `ROOM_FULL` · `ROOM_CLOSED` ·
`NOT_IN_ROOM` · `NOT_HOST` · `GAME_ALREADY_STARTED` · `PLAYER_NOT_READY` · `NOT_ENOUGH_PLAYERS` ·
`GAME_NOT_FOUND` · `GAME_FINISHED` · `GAME_NOT_STARTED` · `NOT_YOUR_TURN` · `CARD_NOT_IN_HAND` ·
`INVALID_CARD` · `INVALID_COLOR` · `COLOR_REQUIRED` · `NO_COLOR_PENDING` · `WILD_DRAW_FOUR_ILLEGAL` ·
`INVALID_UNO_CALL` · `INVALID_UNO_CATCH` · `MUST_RESOLVE_DRAW` · `MUST_PLAY_OR_PASS` · `CANNOT_PASS` ·
`CHALLENGE_PENDING` · `NO_CHALLENGE_PENDING` · `NOT_CHALLENGE_TARGET` · `PLAYER_NOT_IN_GAME` ·
`PERSISTENCE_UNAVAILABLE` · `INTERNAL_ERROR` · `NOT_FOUND`

---

## Socket.IO events

The client authenticates in the handshake:

```ts
io(url, { auth: { token: accessToken } });
```

A socket with no valid token is refused. The identity that comes out of the token is the *only*
identity the server uses — a player id in an event payload is never trusted.

Every client event takes an acknowledgement callback:

```ts
socket.emit('play_card', { gameId, cardId }, (response) => {
  // { ok: true, data } | { ok: false, error: { code, message } }
});
```

### Client → server

| Event                | Payload                                    | Result                                     |
| -------------------- | ------------------------------------------ | ------------------------------------------ |
| `create_room`        | `{ name, maxPlayers, mode, isPrivate }`    | `{ room }`                                 |
| `join_room`          | `{ roomCode }`                             | `{ room }`                                 |
| `leave_room`         | `{ roomCode }`                             | `{ left: true }`                           |
| `player_ready`       | `{ roomCode }`                             | `{ room }`                                 |
| `player_unready`     | `{ roomCode }`                             | `{ room }`                                 |
| `start_game`         | `{ roomCode }`                             | `{ gameId }` — host only, everyone ready   |
| `play_card`          | `{ gameId, cardId, chosenColor? }`         | `{ accepted: true }`                       |
| `draw_card`          | `{ gameId }`                               | `{ accepted: true }`                       |
| `choose_color`       | `{ gameId, color }`                        | `{ accepted: true }`                       |
| `call_uno`           | `{ gameId }`                               | `{ accepted: true }`                       |
| `pass_turn`          | `{ gameId }`                               | `{ accepted: true }` — after drawing       |
| `catch_uno`          | `{ gameId }`                               | `{ accepted: true }` — catch a missed UNO  |
| `accept_draw_four`   | `{ gameId }`                               | `{ accepted: true }`                       |
| `challenge_draw_four`| `{ gameId }`                               | `{ accepted: true }`                       |
| `send_chat_message`  | `{ roomCode, text }`                       | `{ sent: true }`                           |
| `request_game_state` | `{ gameId }`                               | `{ state }` — your personalised view       |
| `request_room_state` | `{ roomCode }`                             | `{ room }`                                 |
| `request_rematch`    | `{ roomCode }`                             | `{ room }`                                 |
| `quick_match`        | `{}`                                       | `{ queued, position }`                     |
| `cancel_quick_match` | `{}`                                       | `{ cancelled: true }`                      |

### Server → client

| Event                  | Payload                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `room_created`         | `{ room }`                                                    |
| `room_updated`         | `{ room }`                                                    |
| `room_closed`          | `{ roomCode, reason }`                                        |
| `player_joined`        | `{ room, player }`                                            |
| `player_left`          | `{ room, playerId, username }`                                |
| `player_ready_changed` | `{ room, playerId, isReady }`                                 |
| `game_started`         | `{ gameId, roomCode }`                                        |
| `game_state_updated`   | `{ state }` — **personalised per player**                     |
| `card_played`          | `{ action }`                                                  |
| `card_drawn`           | `{ playerId, username, count }`                               |
| `turn_changed`         | `{ currentPlayerId, deadline }`                               |
| `color_changed`        | `{ color, playerId }`                                         |
| `uno_called`           | `{ playerId, username }`                                      |
| `uno_penalty`          | `{ playerId, username, cards, caughtBy? }`                    |
| `turn_passed`          | `{ playerId, username }`                                      |
| `draw_four_challenge`  | `{ challengerId, challengerName, accusedId, accusedName, wasBluff, cards }` |
| `game_finished`        | `{ gameId, winnerId, winnerUsername, results, durationMs }`   |
| `player_won`           | `{ gameId, winnerId, winnerUsername }`                        |
| `player_disconnected`  | `{ playerId, username, graceSeconds }`                        |
| `player_reconnected`   | `{ playerId, username }`                                      |
| `chat_message`         | `{ id, userId, username, text, system, timestamp }`           |
| `match_found`          | `{ roomCode }`                                                |
| `queue_update`         | `{ position, size, needed }`                                  |
| `lobby_stats`          | `{ onlinePlayers, activeGames, openRooms }`                   |
| `game_error`           | `{ code, message }`                                           |

### Personalised state

`game_state_updated` is built separately for every player. You receive your own hand in full;
everybody else contributes a **card count and nothing more**. Neither the draw deck's contents nor
another player's cards ever cross the wire.

```ts
interface ClientGameState {
  gameId: string;
  players: PublicPlayer[];      // { id, username, cardCount, isConnected, isCurrentTurn, ... }
  myHand: Card[];               // only ever your own
  topCard: Card | null;
  deckCount: number;            // a count, never the cards
  currentColor: CardColor;
  currentPlayerId: string | null;
  direction: 'clockwise' | 'counter-clockwise';
  status: 'waiting' | 'playing' | 'finished';
  playableCardIds: string[];    // a UI hint; the server re-checks every play
  canCallUno: boolean;
  turnDeadline?: number;
  // ...
}
```

---

## Game rules

**The deck** — 108 cards, generated programmatically: four colours × (one `0`, two each of `1`–`9`,
two each of Skip / Reverse / Draw Two), plus four Wild and four Wild Draw Four. The generator takes a
config object, so a variant deck needs no engine changes. Shuffling is Fisher–Yates over a CSPRNG.

**Dealing and the starter card** — seven cards each (five in Fast mode), then one card is turned up:

| Starter            | What happens                                                          |
| ------------------ | --------------------------------------------------------------------- |
| Number             | Play begins normally                                                  |
| Skip               | The opening player is skipped                                         |
| Reverse            | Direction flips before the first turn                                 |
| Draw Two           | The opening player draws two and is skipped                           |
| Wild               | The opening player **names the colour**, then still takes their turn  |
| Wild Draw Four     | Returned to the deck, which is reshuffled, and another card turned up |

**Playing a card** — legal when it matches the **current colour**, the **number**, or the **symbol**
of the card showing — or when it is a wild.

```text
Showing: RED 7
  Playable:  RED 3 · RED Skip · BLUE 7 · GREEN 7 · WILD · WILD DRAW FOUR
  Rejected:  BLUE 3 · GREEN 8 · YELLOW Skip
```

**Drawing — the official rule** — if you cannot (or choose not to) play, you draw **one** card.
If that card can be played you *may* play it; otherwise your turn ends. Only the card you just drew
may be played — the rest of your hand waits for next turn. The client shows a **Pass** button while
a drawn card is waiting, and the turn clock passes for you if it runs out.

**Skip** — the next player loses their turn. With two players the turn returns to you.

**Reverse** — flips the direction. With two players it acts as a Skip (configurable).

**Draw Two** — the next player draws two and loses their turn.

**Wild** — you choose the colour. The server validates the choice; if you disconnect or run out of
time mid-choice, it picks the colour you hold most of.

**Wild Draw Four — with the official challenge** — you may play it at any time, *including as a
bluff*. Before drawing, the player it was played on chooses:

- **Accept** — they draw four and lose their turn.
- **Challenge** — the accused shows their hand.
  - They *were* bluffing (they held the previous colour): **they** draw four, and the challenger
    plays their turn as normal.
  - They were honest: the challenger draws the four **plus two more**, and loses their turn.

An unanswered challenge is accepted when the turn clock expires. Set
`WILD_DRAW_FOUR_MODE=restricted` for the simplified variant where the server just refuses an illegal
+4 and there is no challenge step.

**UNO — called, and caught** — when you play your second-to-last card you must call UNO. If you
forget, **any other player may catch you** until the next player has taken their turn; the catcher's
button appears on their table and a successful catch costs you two cards. Nobody notices, nobody
pays. You may also pre-call on your own turn while holding two cards, and duplicate calls are
rejected. `UNO_AUTO_PENALTY=true` restores an automatic server-side penalty as a house rule.

**Stacking (+2 on +2)** is *not* an official rule and is off by default. The `stacking` game mode
turns it on: the penalty accumulates and passes along until someone cannot answer and takes the pile.

**Running out of cards to draw** — the discard pile, except the card showing, is shuffled and
becomes the new deck.

**Winning and scoring** — the first player to empty their hand wins the hand. Everyone else's
remaining cards are scored the standard way — number cards face value, Draw Two / Reverse / Skip 20,
Wild and Wild Draw Four 50 — and the total goes to the winner.

**Turn clock** — 30 seconds by default (15 in Fast mode). When it expires the server acts for you:
it answers a pending Wild Draw Four, picks a colour, passes a drawn card, or draws. Set
`TURN_TIMEOUT_SECONDS=0` to switch it off.

**Game modes** — `classic` (7 cards, 30s), `fast` (5 cards, 15s), `stacking` (draw stacking on).

---

## Project structure

```text
uno-arena/
├── apps/
│   ├── web/                               Angular 20 client
│   │   └── src/app/
│   │       ├── core/
│   │       │   ├── auth/                  AuthService (token + current user)
│   │       │   ├── guards/                authGuard, guestGuard
│   │       │   ├── interceptors/          bearer token, error normalising
│   │       │   ├── models/                mirrors of the server contract
│   │       │   └── services/              api, socket, game-state, room,
│   │       │                              user, history, leaderboard, toasts
│   │       ├── shared/
│   │       │   ├── components/            game card, avatar, chat, modal,
│   │       │   │                          toasts, spinner, empty state
│   │       │   └── pipes/                 duration, timeAgo, clock
│   │       ├── features/
│   │       │   ├── auth/                  login, register
│   │       │   ├── lobby/                 dashboard, quick match, open tables
│   │       │   ├── room/                  create, join, waiting room
│   │       │   ├── game/                  table, seats, colour picker, winner
│   │       │   ├── profile/ history/ leaderboard/
│   │       ├── app.routes.ts              lazy routes behind authGuard
│   │       └── app.config.ts
│   │
│   └── server/                            Node API + game engine
│       ├── src/
│       │   ├── config/                    env loading, Express app
│       │   ├── controllers/               auth, user, room, history
│       │   ├── middleware/                auth, validation (zod), errors
│       │   ├── routes/                    /api router + rate limiting
│       │   ├── services/                  db (JSON Server gateway), users,
│       │   │                              rooms, games, history, leaderboard,
│       │   │                              chat, tokens
│       │   ├── sockets/                   handshake auth, room/game/chat
│       │   ├── game/
│       │   │   ├── game-engine.ts         ← every rule decision
│       │   │   ├── deck-manager.ts        deck config, shuffle, recycle
│       │   │   ├── rule-engine.ts         what may be played, and why not
│       │   │   ├── turn-manager.ts        seat order and direction
│       │   │   └── game-state.ts          creation + per-player projection
│       │   ├── models/                    domain types and zod schemas
│       │   └── server.ts
│       └── tests/                         Vitest suites
│
├── data/db.json                           the only persistence
├── scripts/                               db helpers + E2E smoke test
├── docker-compose.yml
└── .env.example
```

---

## How the server stays authoritative

The client can only ever *ask*:

```text
Player clicks RED 7
        ↓
socket.emit('play_card', { gameId, cardId })     ← an intent, not a result
        ↓
Socket.IO handler: is this socket authenticated? is this player seated here?
        ↓
GameEngine.playCard(playerId, cardId)
   · is the game running?
   · is it this player's turn?
   · is that card actually in their hand?
   · is it legal against the current colour and card?
   · does the Wild Draw Four restriction allow it?
        ↓
state mutated on the server, only if all of the above pass
        ↓
one personalised ClientGameState broadcast per player
        ↓
every client re-renders
```

The client never mutates game state. It holds the last state the server sent and renders it.

Things the server refuses to take from a client, each covered by a test: a player id, a card that is
not in the player's hand, a fabricated card id, a move out of turn, a card that does not match, an
illegal Wild Draw Four, a colour from the wrong player, a duplicate UNO call, an action on a game the
caller is not seated at, and any action on a finished game.

`playableCardIds` is sent to the client so it can dim unplayable cards — it is a rendering hint. The
server re-validates every play regardless of what the client was told.

Other protections: bcrypt password hashing, JWT with a short lifetime, per-route REST rate limiting
(stricter on login and registration), a per-socket token bucket, zod validation on every payload,
chat sanitising, CORS restricted to `CLIENT_URL`, and no secrets in the client bundle.

---

## Troubleshooting

**`EADDRINUSE` on port 3000 (or 4200/3001)**
Something else already has the port. Free it, or move the server:
`PORT=3010 npm run dev:server` — real environment variables take precedence over `.env`.
Remember to point the client at the new port in `apps/web/src/environments/environment.ts`.

**"The data service is unavailable" / `PERSISTENCE_UNAVAILABLE`**
JSON Server is not running. Start it with `npm run dev:json` and check
`http://localhost:3000/api/health`. The API deliberately stays up and reports the outage rather
than crashing.

**`db.json` is corrupted or hand-edited into invalid JSON**
`node scripts/ensure-db.mjs` repairs the shape and backs up anything unreadable;
`npm run db:reset` starts from empty.

**The client says "Reconnecting to the game server"**
The socket cannot reach the API. Check the Node server is up and that `CLIENT_URL` includes the
origin you are browsing from — a CORS mismatch shows up exactly like this.

**Signed out unexpectedly**
The access token expired (two hours by default). Sign in again, or raise `JWT_EXPIRES_IN`.

**"It is not your turn" when it clearly is**
Your tab is showing stale state. The client re-syncs on reconnect; a refresh forces it immediately.

**Client tests fail to start**
Karma needs a Chromium browser. Install Chrome, or point at an existing one with
`CHROME_BIN=/path/to/chrome npm run test:web`.

**Only one player, nothing to play against**
You need two browser sessions with two different accounts — a normal window plus a private window.

---

## Deployment

The whole game deploys as **one service**: the Node process serves the API, the Socket.IO endpoint
*and* the built Angular client from the same origin, with JSON Server alongside it. That is what
`apps/web/src/environments/environment.production.ts` already assumes (`/api` and
`window.location.origin`), so there is no cross-origin configuration to get wrong.

### Try the production build locally

```bash
npm run build
JWT_SECRET=a-long-random-string-of-at-least-32-characters npm run start:prod
# open http://localhost:3000
```

`scripts/start-production.mjs` starts JSON Server, waits until it answers, then starts the API. One
port serves everything, and a refresh on `/room/A7K9P2` returns the app rather than a 404.

### Render (one click, from this repo)

`render.yaml` is a Blueprint: **New → Blueprint** in the Render dashboard, point it at this
repository, and it builds the root `Dockerfile` and wires the environment for you.

| Variable     | Notes                                                               |
| ------------ | ------------------------------------------------------------------- |
| `JWT_SECRET` | Generated by the blueprint. The server refuses to boot without one.  |
| `DB_PATH`    | `/app/data/db.json` — container-local, see persistence below.        |
| `CLIENT_URL` | The service's own URL; same-origin, so CORS is trivial.              |

The blueprint targets the **free plan** and deploys as-is. Two things to know about it: the service
sleeps after inactivity (the first request then takes ~30s to wake), and free plans have no
persistent disk, so `db.json` lives inside the container and **resets on every deploy** — accounts
and game history start fresh each time.

To keep data, move the service to a paid plan, uncomment the `disk:` block in `render.yaml` and set
`DB_PATH` to `/data/db.json`.

### Anywhere else

The root `Dockerfile` is self-contained, so Railway, Fly.io, Koyeb or any Docker host works the same
way: build it, set `JWT_SECRET`, mount a volume for `DB_PATH`, expose port 3000.

For the original three-container topology (nginx + API + JSON Server), `docker compose up --build`
still uses `docker-compose.yml` with `apps/server/Dockerfile` and `apps/web/Dockerfile`.

> **Run exactly one instance.** Games, rooms and the matchmaking queue live in that process's
> memory — see Known limitations below.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

- **verify** — typecheck, 159 server tests, 72 client tests, production build
- **smoke** — boots JSON Server and the API, then plays a complete game over real sockets via
  `npm run smoke` and checks that history, statistics and the leaderboard were persisted

## Known limitations

- **Single server instance.** Games, rooms and the matchmaking queue are in-process memory. Two API
  instances would not see each other's games, and sticky sessions would not fix it. Horizontal
  scaling needs a shared adapter and a shared game store — deliberately out of scope here, since the
  brief rules out Redis and databases.
- **A restart ends in-flight games.** Memory is the source of truth while a game runs; only finished
  games reach `db.json`. Clients see the game disappear and return to the lobby.
- **JSON Server is not a database.** It rewrites the whole file on every write. The gateway
  serialises writes to prevent lost updates, but this will not survive heavy concurrent load.
- **No refresh tokens.** Sessions end when the two-hour access token expires.
- **Tokens in `localStorage`.** Standard for a token-based SPA and it survives a refresh, but it is
  readable by script, so the token is deliberately short-lived. The password is never stored.
- **Quick match pairs two players only** and only among players connected to that instance.
- **The leaderboard is recomputed from history** on request (cached for 10 seconds). Fine for
  thousands of games; it would need incremental aggregation beyond that.
- **Chat is transient** — kept in memory (last 50 messages per room) and never persisted.
- **One hand per game, not a match to 500.** Official UNO plays repeated hands until somebody
  reaches 500 points. Each game here is a single hand, scored the official way, and the result goes
  straight to the leaderboard. Multi-hand matches would need cumulative scores held across games.
- **No spectators, no friends list, no private messages.**

---

## Future enhancements

- A shared game store and Socket.IO adapter, so more than one API instance can run
- Persisting in-flight games, so a server restart can resume a table
- Refresh tokens with rotation, and optional two-factor sign-in
- Seasonal leaderboards with incremental aggregation instead of recomputation
- Spectator mode and a replay viewer built on the move log already recorded
- More rule variants: jump-in, seven-zero, progressive draw, custom deck builder
- Single-player practice against a bot (the engine is already headless and testable)
- Friends, invitations and private lobbies
- Sound design, and richer motion for players who want it
- Internationalisation

---

## Licence

Provided as-is for learning and personal use. The game concept is a public-domain shedding-type card
game; all artwork, code and branding here are original to this project.
