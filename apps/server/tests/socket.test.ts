import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/db.service', async () => {
  const { createFakeDb } = await import('./fake-db');
  return { db: createFakeDb() };
});

import { createApp } from '../src/config/app';
import type { ClientGameState } from '../src/models/game.model';
import type { Room } from '../src/models/room.model';
import { db } from '../src/services/db.service';
import { gameManager } from '../src/services/game-manager';
import { roomService } from '../src/services/room.service';
import { createSocketServer, type AppIO } from '../src/sockets';
import type { FakeDb } from './fake-db';
import { card, num } from './helpers';

const fake = db as unknown as FakeDb;

let server: http.Server;
let io: AppIO;
let base: string;
const clients: ClientSocket[] = [];

/* ------------------------------- utilities -------------------------------- */

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<any>;
}

async function signUp(username: string) {
  const password = 'super-secret-1';
  const result = await post('/api/auth/register', {
    username,
    email: `${username.toLowerCase()}@example.com`,
    password,
    confirmPassword: password,
  });
  return { token: result.accessToken as string, user: result.user as { id: string; username: string } };
}

function connect(token: string | undefined): ClientSocket {
  const socket = ioClient(base, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

function waitFor<T = any>(socket: ClientSocket, event: string, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Emits an event and resolves with its acknowledgement, throwing on a rejection. */
function emit<T = any>(socket: ClientSocket, event: string, payload: unknown, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out on "${event}"`)), timeout);
    socket.emit(event, payload, (response: { ok: boolean; data?: T; error?: { code: string; message: string } }) => {
      clearTimeout(timer);
      if (response?.ok) resolve(response.data as T);
      else reject(Object.assign(new Error(response?.error?.message ?? 'failed'), { code: response?.error?.code }));
    });
  });
}

/** Signs in two players, seats them in a room and starts the game. */
async function startTwoPlayerGame() {
  const host = await signUp('Sachin');
  const guest = await signUp('Rahul');

  const hostSocket = connect(host.token);
  const guestSocket = connect(guest.token);
  await Promise.all([waitFor(hostSocket, 'connect'), waitFor(guestSocket, 'connect')]);

  const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
    name: 'Test Table',
    maxPlayers: 2,
    mode: 'classic',
    isPrivate: true,
  });

  await emit(guestSocket, 'join_room', { roomCode: room.code });
  await emit(hostSocket, 'player_ready', { roomCode: room.code });
  await emit(guestSocket, 'player_ready', { roomCode: room.code });

  const hostState = waitFor<{ state: ClientGameState }>(hostSocket, 'game_state_updated');
  const guestState = waitFor<{ state: ClientGameState }>(guestSocket, 'game_state_updated');
  const { gameId } = await emit<{ gameId: string }>(hostSocket, 'start_game', { roomCode: room.code });

  let hostView = (await hostState).state;
  let guestView = (await guestState).state;

  // A Wild turned up as the starter leaves the opening player owing a colour
  // (the official rule). Settle it here so tests start from a playable table
  // rather than intermittently tripping over the colour guard.
  if (hostView.pendingColorChoiceBy) {
    const chooser = hostView.pendingColorChoiceBy === hostView.myPlayerId ? hostSocket : guestSocket;
    await emit(chooser, 'choose_color', { gameId, color: 'red' });
    hostView = (await emit<{ state: ClientGameState }>(hostSocket, 'request_game_state', { gameId })).state;
    guestView = (await emit<{ state: ClientGameState }>(guestSocket, 'request_game_state', { gameId })).state;
  }

  return {
    host,
    guest,
    hostSocket,
    guestSocket,
    room,
    gameId,
    states: { host: hostView, guest: guestView },
  };
}

/* --------------------------------- setup ---------------------------------- */

beforeAll(async () => {
  server = http.createServer(createApp());
  io = createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  gameManager.shutdown();
  await io.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  fake.__reset();
  roomService.clear();
  gameManager.shutdown();
});

afterEach(() => {
  while (clients.length) clients.pop()?.disconnect();
});

/* --------------------------------- tests ---------------------------------- */

describe('socket authentication', () => {
  it('refuses a connection without a token', async () => {
    const socket = connect(undefined);
    const error = await waitFor<Error>(socket, 'connect_error');
    expect(error.message).toMatch(/authentication/i);
  });

  it('refuses a forged token', async () => {
    const socket = connect('eyJhbGciOiJIUzI1NiJ9.fake.signature');
    const error = await waitFor<Error>(socket, 'connect_error');
    expect(error.message).toMatch(/not valid/i);
  });

  it('accepts a real token', async () => {
    const { token } = await signUp('Sachin');
    const socket = connect(token);
    await waitFor(socket, 'connect');
    expect(socket.connected).toBe(true);
  });
});

describe('room lifecycle over sockets', () => {
  it('broadcasts a join to everyone already in the room', async () => {
    const host = await signUp('Sachin');
    const guest = await signUp('Rahul');
    const hostSocket = connect(host.token);
    const guestSocket = connect(guest.token);
    await Promise.all([waitFor(hostSocket, 'connect'), waitFor(guestSocket, 'connect')]);

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Test Table',
      maxPlayers: 4,
      mode: 'classic',
      isPrivate: true,
    });

    const joined = waitFor<{ room: Room; player: { username: string } }>(hostSocket, 'player_joined');
    await emit(guestSocket, 'join_room', { roomCode: room.code });

    const payload = await joined;
    expect(payload.player.username).toBe('Rahul');
    expect(payload.room.players).toHaveLength(2);
  });

  it('rejects an unknown room code', async () => {
    const { token } = await signUp('Sachin');
    const socket = connect(token);
    await waitFor(socket, 'connect');

    await expect(emit(socket, 'join_room', { roomCode: 'ZZZZZZ' })).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
  });

  it('enforces the room capacity', async () => {
    const host = await signUp('Sachin');
    const guest = await signUp('Rahul');
    const third = await signUp('Anil');

    const hostSocket = connect(host.token);
    const guestSocket = connect(guest.token);
    const thirdSocket = connect(third.token);
    await Promise.all([
      waitFor(hostSocket, 'connect'),
      waitFor(guestSocket, 'connect'),
      waitFor(thirdSocket, 'connect'),
    ]);

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Two Seats',
      maxPlayers: 2,
      mode: 'classic',
      isPrivate: true,
    });
    await emit(guestSocket, 'join_room', { roomCode: room.code });

    await expect(emit(thirdSocket, 'join_room', { roomCode: room.code })).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });
  });

  it('lets only the host start, and only once everyone is ready', async () => {
    const host = await signUp('Sachin');
    const guest = await signUp('Rahul');
    const hostSocket = connect(host.token);
    const guestSocket = connect(guest.token);
    await Promise.all([waitFor(hostSocket, 'connect'), waitFor(guestSocket, 'connect')]);

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Test Table',
      maxPlayers: 2,
      mode: 'classic',
      isPrivate: true,
    });
    await emit(guestSocket, 'join_room', { roomCode: room.code });

    await expect(emit(guestSocket, 'start_game', { roomCode: room.code })).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
    await expect(emit(hostSocket, 'start_game', { roomCode: room.code })).rejects.toMatchObject({
      code: 'PLAYER_NOT_READY',
    });

    await emit(hostSocket, 'player_ready', { roomCode: room.code });
    await emit(guestSocket, 'player_ready', { roomCode: room.code });

    const started = waitFor<{ gameId: string }>(guestSocket, 'game_started');
    const ack = await emit<{ gameId: string }>(hostSocket, 'start_game', { roomCode: room.code });
    expect((await started).gameId).toBe(ack.gameId);
  });

  it('enables the start button as soon as the last player readies up', async () => {
    // The reported flow: the host readies up first, alone in the room, then a
    // second player joins and readies. Every snapshot the host receives must
    // carry the other player's ready state, because that is what the Start
    // button is bound to.
    const host = await signUp('Sachin');
    const guest = await signUp('Rahul');
    const hostSocket = connect(host.token);
    const guestSocket = connect(guest.token);
    await Promise.all([waitFor(hostSocket, 'connect'), waitFor(guestSocket, 'connect')]);

    const hostSnapshots: Room[] = [];
    hostSocket.on('room_updated', ({ room }: { room: Room }) => hostSnapshots.push(room));

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Ready Order',
      maxPlayers: 4,
      mode: 'classic',
      isPrivate: true,
    });

    await emit(hostSocket, 'player_ready', { roomCode: room.code });
    await emit(guestSocket, 'join_room', { roomCode: room.code });

    // Joining must not clear the host's existing ready state.
    await vi.waitFor(() => {
      const latest = hostSnapshots.at(-1)!;
      expect(latest.players).toHaveLength(2);
      expect(latest.players.find((player) => player.id === host.user.id)?.isReady).toBe(true);
    });

    await emit(guestSocket, 'player_ready', { roomCode: room.code });

    await vi.waitFor(() => {
      const latest = hostSnapshots.at(-1)!;
      expect(latest.players.every((player) => player.isReady)).toBe(true);
    });

    // Which is exactly the condition the host's Start button waits for.
    const { gameId } = await emit<{ gameId: string }>(hostSocket, 'start_game', { roomCode: room.code });
    expect(gameId).toBeTruthy();
  });

  it('moves every player to the game when the host starts', async () => {
    const host = await signUp('Sachin');
    const guest = await signUp('Rahul');
    const hostSocket = connect(host.token);
    const guestSocket = connect(guest.token);
    await Promise.all([waitFor(hostSocket, 'connect'), waitFor(guestSocket, 'connect')]);

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Switch Together',
      maxPlayers: 2,
      mode: 'classic',
      isPrivate: true,
    });
    await emit(guestSocket, 'join_room', { roomCode: room.code });
    await emit(hostSocket, 'player_ready', { roomCode: room.code });
    await emit(guestSocket, 'player_ready', { roomCode: room.code });

    // Both clients navigate on game_started, and both need their own hand.
    const hostStarted = waitFor<{ gameId: string }>(hostSocket, 'game_started');
    const guestStarted = waitFor<{ gameId: string }>(guestSocket, 'game_started');
    const hostDealt = waitFor<{ state: ClientGameState }>(hostSocket, 'game_state_updated');
    const guestDealt = waitFor<{ state: ClientGameState }>(guestSocket, 'game_state_updated');

    const { gameId } = await emit<{ gameId: string }>(hostSocket, 'start_game', { roomCode: room.code });

    expect((await hostStarted).gameId).toBe(gameId);
    expect((await guestStarted).gameId).toBe(gameId);

    // Both are dealt in; a Draw Two starter adds two to the opening seat.
    const hostState = (await hostDealt).state;
    const starterDraw = hostState.topCard?.type === 'draw2' ? 2 : 0;
    expect(hostState.myHand).toHaveLength(7 + starterDraw);
    expect((await guestDealt).state.myHand).toHaveLength(7);
  });

  it('refuses to start with a single player', async () => {
    const host = await signUp('Sachin');
    const hostSocket = connect(host.token);
    await waitFor(hostSocket, 'connect');

    const { room } = await emit<{ room: Room }>(hostSocket, 'create_room', {
      name: 'Lonely',
      maxPlayers: 2,
      mode: 'classic',
      isPrivate: true,
    });
    await emit(hostSocket, 'player_ready', { roomCode: room.code });

    await expect(emit(hostSocket, 'start_game', { roomCode: room.code })).rejects.toMatchObject({
      code: 'NOT_ENOUGH_PLAYERS',
    });
  });
});

describe('gameplay over sockets', () => {
  it('deals a private hand to each player', async () => {
    const { states, host, guest } = await startTwoPlayerGame();

    // A Draw Two starter makes the opening seat (the host) pick up two before
    // play begins, so the expected size follows the card that turned up.
    const starterDraw = states.host.topCard?.type === 'draw2' ? 2 : 0;
    expect(states.host.myHand).toHaveLength(7 + starterDraw);
    expect(states.guest.myHand).toHaveLength(7);
    expect(states.host.myPlayerId).toBe(host.user.id);

    // Neither player's payload contains the other's card ids.
    const guestCardIds = states.guest.myHand.map((card) => card.id);
    const hostPayload = JSON.stringify(states.host);
    for (const id of guestCardIds) expect(hostPayload).not.toContain(id);

    expect(states.host.players.find((player) => player.id === guest.user.id)).toMatchObject({ cardCount: 7 });
    expect(states.guest.players.find((player) => player.id === host.user.id)).toMatchObject({
      cardCount: 7 + starterDraw,
    });
  });

  it('rejects a play from the player whose turn it is not', async () => {
    const { states, hostSocket, guestSocket, gameId } = await startTwoPlayerGame();
    const waiting = states.host.currentPlayerId === states.host.myPlayerId ? guestSocket : hostSocket;
    const waitingState = states.host.currentPlayerId === states.host.myPlayerId ? states.guest : states.host;

    await expect(
      emit(waiting, 'play_card', { gameId, cardId: waitingState.myHand[0].id }),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
  });

  it('rejects a card the player does not hold', async () => {
    const { states, hostSocket, guestSocket, gameId } = await startTwoPlayerGame();
    const active = states.host.currentPlayerId === states.host.myPlayerId ? hostSocket : guestSocket;

    await expect(emit(active, 'play_card', { gameId, cardId: 'forged-card-id' })).rejects.toMatchObject({
      code: 'CARD_NOT_IN_HAND',
    });
  });

  it('also reports the rejection on the game_error channel', async () => {
    const { states, hostSocket, guestSocket, gameId } = await startTwoPlayerGame();
    const active = states.host.currentPlayerId === states.host.myPlayerId ? hostSocket : guestSocket;

    const errorEvent = waitFor<{ code: string }>(active, 'game_error');
    await emit(active, 'play_card', { gameId, cardId: 'forged-card-id' }).catch(() => undefined);
    expect((await errorEvent).code).toBe('CARD_NOT_IN_HAND');
  });

  it('applies a legal play and pushes new state to both players', async () => {
    const { hostSocket, guestSocket, gameId, states } = await startTwoPlayerGame();

    // Force a deterministic position: the host is on turn with one legal card.
    const engine = gameManager.get(gameId)!;
    const playable = num('red', 3);
    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === states.host.myPlayerId);
    engine.state.players.forEach((player) => {
      player.hand = [num('blue', 8), num('green', 2)];
    });
    engine.player(states.host.myPlayerId)!.hand = [playable, num('blue', 8)];
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';

    const guestUpdate = waitFor<{ state: ClientGameState }>(guestSocket, 'game_state_updated');
    const played = waitFor<{ action: { cardId: string } }>(guestSocket, 'card_played');

    await emit(hostSocket, 'play_card', { gameId, cardId: playable.id });

    expect((await played).action.cardId).toBe(playable.id);
    const next = (await guestUpdate).state;
    expect(next.topCard?.id).toBe(playable.id);
    expect(next.currentColor).toBe('red');
    expect(next.players.find((p) => p.id === states.host.myPlayerId)!.cardCount).toBe(1);
  });

  it('draws a card and ends the turn when it cannot be played', async () => {
    const { hostSocket, guestSocket, gameId, states } = await startTwoPlayerGame();
    const engine = gameManager.get(gameId)!;

    // Deterministic position: an unplayable card on top of the deck.
    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === states.host.myPlayerId);
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';
    engine.state.deck = [num('blue', 9)];

    const before = engine.player(states.host.myPlayerId)!.hand.length;
    const drawn = waitFor<{ playerId: string; count: number }>(guestSocket, 'card_drawn');

    await emit(hostSocket, 'draw_card', { gameId });

    expect((await drawn).count).toBe(1);
    expect(engine.player(states.host.myPlayerId)!.hand).toHaveLength(before + 1);
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(states.guest.myPlayerId);
  });

  it('keeps the turn when the drawn card is playable, then passes on request', async () => {
    const { hostSocket, gameId, states } = await startTwoPlayerGame();
    const engine = gameManager.get(gameId)!;

    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === states.host.myPlayerId);
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';
    engine.state.deck = [num('red', 4)];

    await emit(hostSocket, 'draw_card', { gameId });

    // Official rule: the drawn card is playable, so the turn stays put.
    expect(engine.state.drawnCard?.playerId).toBe(states.host.myPlayerId);
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(states.host.myPlayerId);

    await emit(hostSocket, 'pass_turn', { gameId });
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(states.guest.myPlayerId);
  });

  it('plays a complete game through to a winner and persists it', async () => {
    const { hostSocket, guestSocket, gameId, states, host } = await startTwoPlayerGame();
    const engine = gameManager.get(gameId)!;

    const winningCard = num('red', 5);
    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === host.user.id);
    engine.player(host.user.id)!.hand = [winningCard];
    engine.player(states.guest.myPlayerId)!.hand = [num('blue', 9), num('green', 4)];
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';

    const finished = waitFor<{ winnerId: string; results: Array<{ id: string; isWinner: boolean }> }>(
      guestSocket,
      'game_finished',
    );
    const won = waitFor<{ winnerUsername: string }>(hostSocket, 'player_won');

    await emit(hostSocket, 'play_card', { gameId, cardId: winningCard.id });

    const result = await finished;
    expect(result.winnerId).toBe(host.user.id);
    expect((await won).winnerUsername).toBe('Sachin');
    expect(result.results.find((player) => player.id === host.user.id)?.isWinner).toBe(true);

    // History and lifetime statistics are written once, at the end of the game.
    await vi.waitFor(() => {
      expect(fake.__rows('gameHistory')).toHaveLength(1);
    });
    const [record] = fake.__rows('gameHistory') as unknown as Array<{ winnerId: string; moveCount: number }>;
    expect(record.winnerId).toBe(host.user.id);

    await vi.waitFor(() => {
      const stored = (fake.__rows('users') as unknown as Array<{ id: string; stats: { gamesPlayed: number; gamesWon: number } }>)
        .find((user) => user.id === host.user.id);
      expect(stored?.stats.gamesPlayed).toBe(1);
      expect(stored?.stats.gamesWon).toBe(1);
    });
  });

  it('runs a Wild Draw Four challenge end to end', async () => {
    const { hostSocket, guestSocket, gameId, states } = await startTwoPlayerGame();
    const engine = gameManager.get(gameId)!;

    // The host bluffs: they hold a red but play +4 on red anyway.
    const wild4 = card('wild', 'wild_draw4');
    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === states.host.myPlayerId);
    engine.player(states.host.myPlayerId)!.hand = [wild4, num('red', 3)];
    engine.player(states.guest.myPlayerId)!.hand = [num('blue', 2), num('blue', 5)];
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';

    await emit(hostSocket, 'play_card', { gameId, cardId: wild4.id, chosenColor: 'green' });

    // Nothing drawn yet - the guest has to answer first.
    expect(engine.player(states.guest.myPlayerId)!.hand).toHaveLength(2);
    expect(engine.state.pendingWildDrawFour?.targetPlayerId).toBe(states.guest.myPlayerId);

    const outcome = waitFor<{ wasBluff: boolean; cards: number }>(hostSocket, 'draw_four_challenge');
    await emit(guestSocket, 'challenge_draw_four', { gameId });

    const result = await outcome;
    expect(result.wasBluff).toBe(true);
    expect(result.cards).toBe(4);
    // The bluffer picks up, and the turn stays with the challenger.
    expect(engine.player(states.host.myPlayerId)!.hand).toHaveLength(1 + 4);
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(states.guest.myPlayerId);
  });

  it('lets another player catch a missed UNO', async () => {
    const { hostSocket, guestSocket, gameId, states } = await startTwoPlayerGame();
    const engine = gameManager.get(gameId)!;

    const last = num('red', 3);
    engine.state.currentPlayerIndex = engine.state.players.findIndex((p) => p.id === states.host.myPlayerId);
    engine.player(states.host.myPlayerId)!.hand = [last, num('blue', 8)];
    engine.player(states.guest.myPlayerId)!.hand = [num('blue', 2), num('blue', 5), num('green', 1)];
    engine.state.discardPile = [num('red', 7)];
    engine.state.currentColor = 'red';

    // Host plays down to one card and stays quiet.
    await emit(hostSocket, 'play_card', { gameId, cardId: last.id });
    expect(engine.state.unoVulnerable?.playerId).toBe(states.host.myPlayerId);

    const penalty = waitFor<{ playerId: string; cards: number; caughtBy?: string }>(hostSocket, 'uno_penalty');
    await emit(guestSocket, 'catch_uno', { gameId });

    const caught = await penalty;
    expect(caught.playerId).toBe(states.host.myPlayerId);
    expect(caught.caughtBy).toBe('Rahul');
    expect(engine.player(states.host.myPlayerId)!.hand).toHaveLength(1 + 2);
  });

  it('refuses game actions from someone who is not seated', async () => {
    const { gameId } = await startTwoPlayerGame();
    const intruder = await signUp('Intruder');
    const socket = connect(intruder.token);
    await waitFor(socket, 'connect');

    await expect(emit(socket, 'draw_card', { gameId })).rejects.toMatchObject({ code: 'PLAYER_NOT_IN_GAME' });
    await expect(emit(socket, 'request_game_state', { gameId })).rejects.toMatchObject({
      code: 'PLAYER_NOT_IN_GAME',
    });
  });
});

describe('chat', () => {
  it('delivers a message to the room and sanitises markup', async () => {
    const { hostSocket, guestSocket, room } = await startTwoPlayerGame();

    const received = waitFor<{ username: string; text: string }>(guestSocket, 'chat_message');
    await emit(hostSocket, 'send_chat_message', { roomCode: room.code, text: '<script>alert(1)</script> gg' });

    const message = await received;
    expect(message.username).toBe('Sachin');
    expect(message.text).not.toContain('<script>');
    expect(message.text).toContain('gg');
  });

  it('refuses chat in a room the player is not in', async () => {
    const { room } = await startTwoPlayerGame();
    const outsider = await signUp('Outsider');
    const socket = connect(outsider.token);
    await waitFor(socket, 'connect');

    await expect(emit(socket, 'send_chat_message', { roomCode: room.code, text: 'hello' })).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });
  });

  it('rejects an over-long message', async () => {
    const { hostSocket, room } = await startTwoPlayerGame();
    await expect(
      emit(hostSocket, 'send_chat_message', { roomCode: room.code, text: 'x'.repeat(5000) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('disconnect and reconnect', () => {
  it('marks a player offline and restores them with their hand intact', async () => {
    const { hostSocket, guestSocket, gameId, guest, states } = await startTwoPlayerGame();

    const handBefore = states.guest.myHand.map((card) => card.id);

    const wentDown = waitFor<{ playerId: string }>(hostSocket, 'player_disconnected');
    guestSocket.disconnect();
    expect((await wentDown).playerId).toBe(guest.user.id);

    const engine = gameManager.get(gameId)!;
    expect(engine.player(guest.user.id)!.isConnected).toBe(false);
    expect(engine.state.players).toHaveLength(2);

    // Coming back with the same token restores the seat rather than adding one.
    const cameBack = waitFor<{ playerId: string }>(hostSocket, 'player_reconnected');
    const revived = connect(guest.token);
    await waitFor(revived, 'connect');

    expect((await cameBack).playerId).toBe(guest.user.id);
    expect(engine.state.players).toHaveLength(2);
    expect(engine.player(guest.user.id)!.isConnected).toBe(true);

    const { state } = await emit<{ state: ClientGameState }>(revived, 'request_game_state', { gameId });
    expect(state.myHand.map((card) => card.id)).toEqual(handBefore);
  });
});
