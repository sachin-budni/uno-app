/**
 * End-to-end smoke test against the *running* stack:
 * Angular is not involved - two scripted players drive the real Socket.IO API,
 * the real game engine and the real JSON Server persistence.
 */
import { io } from 'socket.io-client';

const API = process.env.SMOKE_API ?? process.env.API_URL ?? 'http://127.0.0.1:3000';
const JSON_SERVER = process.env.SMOKE_JSON ?? 'http://127.0.0.1:3001';

const log = (...args) => console.log(...args);
const fail = (message) => {
  console.error('FAIL:', message);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const stamp = Date.now();

async function signUp(name) {
  const username = `${name}${stamp}`.slice(0, 20);
  const password = 'super-secret-1';
  const { status, body } = await api('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username.toLowerCase()}@example.com`, password, confirmPassword: password },
  });
  assert(status === 201, `register ${name} -> ${status} ${JSON.stringify(body)}`);
  return { token: body.accessToken, user: body.user, username };
}

function connect(token) {
  const socket = io(API, { auth: { token }, transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emit(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok) resolve(response.data);
      else reject(new Error(`${event}: ${response?.error?.code} ${response?.error?.message}`));
    });
  });
}

/**
 * A very simple player: resolve a pending colour, otherwise play the first legal
 * card, otherwise draw. Returns an `act` function so the caller can also feed it
 * the opening state that arrived before the listener was attached.
 */
function autoPlay(socket, label, stats) {
  let acting = false;
  let latest = null;

  const act = async (state) => {
    if (state) latest = state;
    if (process.env.SMOKE_DEBUG) {
      log(`  [debug ${label}] status=${state?.status} turn=${state?.currentPlayerId === state?.myPlayerId} playable=${state?.playableCardIds?.length} acting=${acting}`);
    }
    // A state that lands mid-action is kept in `latest` and picked up below,
    // so the bot can never sit on a stale view and stall the table.
    if (!state || state.status !== 'playing' || acting) return;

    if (state.pendingColorChoiceBy === state.myPlayerId) {
      acting = true;
      try {
        await emit(socket, 'choose_color', { gameId: state.gameId, color: 'red' });
      } catch (error) {
        if (!/NO_COLOR_PENDING/.test(error.message)) log(`  ${label} colour error: ${error.message}`);
      }
      acting = false;
      return;
    }

    // A Wild Draw Four aimed at us has to be answered before anything else.
    if (state.wildDrawFour && state.wildDrawFour.targetPlayerId === state.myPlayerId) {
      acting = true;
      try {
        await emit(socket, 'accept_draw_four', { gameId: state.gameId });
      } catch (error) {
        if (!/NO_CHALLENGE_PENDING/.test(error.message)) log(`  ${label} challenge error: ${error.message}`);
      }
      acting = false;
      return;
    }

    if (state.currentPlayerId !== state.myPlayerId) return;

    acting = true;
    try {
      if (state.canCallUno) {
        await emit(socket, 'call_uno', { gameId: state.gameId }).catch(() => undefined);
        stats.unoCalls++;
      }

      const cardId = state.playableCardIds[0];
      if (cardId) {
        const card = state.myHand.find((entry) => entry.id === cardId);
        const isWild = card?.type === 'wild' || card?.type === 'wild_draw4';
        await emit(socket, 'play_card', {
          gameId: state.gameId,
          cardId,
          ...(isWild ? { chosenColor: 'blue' } : {}),
        });
        stats.plays++;
      } else if (state.canPass) {
        // Official rule: we drew a card we do not want - end the turn.
        await emit(socket, 'pass_turn', { gameId: state.gameId });
      } else {
        await emit(socket, 'draw_card', { gameId: state.gameId });
        stats.draws++;
      }
    } catch (error) {
      if (/RATE_LIMITED/.test(error.message)) {
        // Bots act faster than any person would; back off and pick it up again.
        await new Promise((resolve) => setTimeout(resolve, 300));
        latest = state;
      } else if (!/NOT_YOUR_TURN|GAME_FINISHED|COLOR_REQUIRED/.test(error.message)) {
        log(`  ${label} action error: ${error.message}`);
      }
    } finally {
      acting = false;
    }

    // Anything that arrived while we were waiting on the server gets handled now.
    if (latest && latest !== state) await act(latest);
    else if (latest === state && state.currentPlayerId === state.myPlayerId && state.status === 'playing') {
      // Retry path after a back-off, using the most recent view we hold.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const refreshed = await emit(socket, 'request_game_state', { gameId: state.gameId }).catch(() => null);
      if (refreshed?.state && refreshed.state.status === 'playing') await act(refreshed.state);
    }
  };

  socket.on('game_state_updated', ({ state }) => void act(state));
  return act;
}

async function main() {
  log('\n=== UNO Arena end-to-end smoke test ===\n');

  // 1. Registration + auth
  const host = await signUp('SmokeHost');
  const guest = await signUp('SmokeGuest');
  log(`1. Registered ${host.username} and ${guest.username}`);

  const me = await api('/api/auth/me', { token: host.token });
  assert(me.status === 200 && me.body.user.id === host.user.id, 'GET /api/auth/me failed');
  assert(!JSON.stringify(me.body).includes('super-secret-1'), 'password leaked in /me response');
  const noAuth = await api('/api/auth/me');
  assert(noAuth.status === 401, 'protected route reachable without a token');
  log('2. JWT auth works and protected routes are closed');

  // 2. Sockets
  const hostSocket = await connect(host.token);
  const guestSocket = await connect(guest.token);
  log('3. Both players connected over Socket.IO');

  await new Promise((resolve, reject) => {
    const socket = io(API, { auth: {}, transports: ['websocket'], forceNew: true, reconnection: false });
    socket.once('connect', () => reject(new Error('unauthenticated socket was accepted')));
    socket.once('connect_error', () => {
      socket.close();
      resolve();
    });
  });
  log('4. Unauthenticated sockets are rejected');

  // 3. Room
  const { room } = await emit(hostSocket, 'create_room', {
    name: 'Smoke Test Table',
    maxPlayers: 2,
    mode: 'classic',
    isPrivate: true,
  });
  assert(/^[A-Z0-9]{6}$/.test(room.code), `bad room code ${room.code}`);
  log(`5. Room created with code ${room.code}`);

  const joined = new Promise((resolve) => hostSocket.once('player_joined', resolve));
  await emit(guestSocket, 'join_room', { roomCode: room.code });
  await joined;
  log('6. Second player joined and the host was notified in real time');

  await emit(hostSocket, 'send_chat_message', { roomCode: room.code, text: '<b>hi</b> there' });
  log('7. Chat message delivered and sanitised');

  let startError = null;
  await emit(hostSocket, 'start_game', { roomCode: room.code }).catch((error) => (startError = error.message));
  assert(startError?.includes('PLAYER_NOT_READY'), 'start succeeded before everyone was ready');
  log('8. Start refused until every player is ready');

  await emit(hostSocket, 'player_ready', { roomCode: room.code });
  await emit(guestSocket, 'player_ready', { roomCode: room.code });

  // 4. Game
  const hostStats = { plays: 0, draws: 0, unoCalls: 0 };
  const guestStats = { plays: 0, draws: 0, unoCalls: 0 };

  const firstState = new Promise((resolve) => hostSocket.once('game_state_updated', resolve));
  const finished = new Promise((resolve, reject) => {
    hostSocket.once('game_finished', resolve);
    setTimeout(() => reject(new Error('game did not finish within 90s')), 90_000);
  });

  const { gameId } = await emit(hostSocket, 'start_game', { roomCode: room.code });
  const { state } = await firstState;

  assert(state.myHand.length === 7, `expected 7 cards, got ${state.myHand.length}`);
  assert(state.topCard, 'no starter card');
  const guestSeat = state.players.find((player) => player.id === guest.user.id);
  assert(guestSeat.cardCount === 7, 'opponent card count wrong');
  assert(!('hand' in guestSeat), 'opponent hand exposed to client');
  log(`9. Game ${gameId.slice(0, 8)} dealt 7 cards each; opponent hands are counts only`);

  // Anti-cheat: a forged card id must be refused.
  let cheat = null;
  await emit(hostSocket, 'play_card', { gameId, cardId: 'forged-card' }).catch((error) => (cheat = error.message));
  assert(/CARD_NOT_IN_HAND|NOT_YOUR_TURN/.test(cheat ?? ''), `forged card was not rejected (${cheat})`);
  log('10. Forged card ids are rejected by the server');

  const hostAct = autoPlay(hostSocket, 'host', hostStats);
  const guestAct = autoPlay(guestSocket, 'guest', guestStats);

  // The opening state was delivered before the listeners existed, so hand the
  // current one to each bot to start the game moving.
  for (const [socket, act] of [
    [hostSocket, hostAct],
    [guestSocket, guestAct],
  ]) {
    const current = await emit(socket, 'request_game_state', { gameId });
    await act(current.state);
  }

  const result = await finished;
  assert(result.winnerId, 'game finished without a winner');
  const winner = result.results.find((player) => player.isWinner);
  log(`11. Game finished - ${result.winnerUsername} won in ${Math.round(result.durationMs / 1000)}s`);
  log(`    moves: host ${hostStats.plays} plays / ${hostStats.draws} draws, guest ${guestStats.plays} plays / ${guestStats.draws} draws`);
  assert(winner.cardsLeft === 0, 'winner still holds cards');

  // 5. Persistence
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const historyRows = await fetch(`${JSON_SERVER}/gameHistory`).then((response) => response.json());
  const record = historyRows.find((row) => row.gameId === gameId);
  assert(record, 'game not written to db.json');
  assert(record.winnerId === result.winnerId, 'persisted winner mismatch');
  assert(record.moveCount > 0, 'no moves persisted');
  log(`12. Game history written to db.json (${record.moveCount} moves recorded)`);

  const users = await fetch(`${JSON_SERVER}/users`).then((response) => response.json());
  const hostRow = users.find((row) => row.id === host.user.id);
  assert(hostRow.stats.gamesPlayed === 1, `host gamesPlayed=${hostRow.stats.gamesPlayed}`);
  assert(hostRow.passwordHash.startsWith('$2'), 'password not hashed at rest');
  assert(!('password' in hostRow), 'plain password stored');
  const wins = users.filter((row) => [host.user.id, guest.user.id].includes(row.id)).reduce((total, row) => total + row.stats.gamesWon, 0);
  assert(wins === 1, `expected exactly one win recorded, got ${wins}`);
  log('13. Player statistics updated; passwords stored as bcrypt hashes only');

  const board = await api('/api/leaderboard', { token: host.token });
  assert(board.status === 200 && board.body.entries.length > 0, 'leaderboard empty');
  const top = board.body.entries.find((entry) => entry.userId === result.winnerId);
  assert(top && top.gamesWon >= 1, 'winner missing from leaderboard');
  log(`14. Leaderboard built from history (rank ${top.rank}: ${top.username}, ${top.winRate}% win rate)`);

  const myHistory = await api('/api/game-history', { token: host.token });
  assert(myHistory.body.games.some((game) => game.gameId === gameId), 'game missing from player history');
  log('15. Game appears in the player history API');

  // 6. Reconnection
  const rematch = await emit(hostSocket, 'request_rematch', { roomCode: room.code });
  assert(rematch.room.status === 'waiting', 'rematch did not reopen the room');
  log('16. Rematch returns the table to the waiting room');

  hostSocket.close();
  guestSocket.close();
  log('\nALL SMOKE CHECKS PASSED\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nSMOKE TEST ERROR:', error);
  process.exit(1);
});
