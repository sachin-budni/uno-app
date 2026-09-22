import type { Server } from 'socket.io';
import { config } from '../config/env';
import { GameEngine, type EngineEvent, type EngineResult } from '../game/game-engine';
import type { PlayableColor } from '../models/card.model';
import type { GameRules } from '../models/game.model';
import type { Room } from '../models/room.model';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../models/socket.model';
import { ERROR_CODES, notFound } from '../utils/errors';
import { logger } from '../utils/logger';
import { historyService } from './history.service';
import { leaderboardService } from './leaderboard.service';
import { roomService } from './room.service';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const gameRoomKey = (gameId: string) => `game:${gameId}`;
export const userRoomKey = (userId: string) => `user:${userId}`;
export const lobbyRoomKey = () => 'lobby';

interface GameTimers {
  turn?: NodeJS.Timeout;
  uno?: NodeJS.Timeout;
}

/** Rule presets selected by the room's game mode. */
function rulesForMode(mode: Room['mode']): Partial<GameRules> {
  switch (mode) {
    case 'fast':
      return { initialHandSize: 5, turnTimeoutSeconds: Math.min(config.game.turnTimeoutSeconds, 15) };
    case 'stacking':
      return { allowDrawStacking: true };
    default:
      return {};
  }
}

/**
 * Owns every in-flight game: the engines, their clocks and the fan-out to
 * sockets. Games live only in this process's memory - db.json is written once,
 * when a game ends.
 */
class GameManager {
  private readonly games = new Map<string, GameEngine>();
  private readonly timers = new Map<string, GameTimers>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  /** userId -> queued since (epoch ms). Insertion order is queue order. */
  private readonly matchmakingQueue = new Map<string, number>();
  private io?: IO;

  attach(io: IO): void {
    this.io = io;
  }

  /* ------------------------------ lifecycle ------------------------------- */

  createGameForRoom(room: Room): GameEngine {
    const engine = GameEngine.create({
      roomId: room.id,
      roomCode: room.code,
      seats: room.players.map((player) => ({
        id: player.id,
        username: player.username,
        avatar: player.avatar,
      })),
      rules: { ...rulesForMode(room.mode), maxPlayers: room.maxPlayers },
    });

    this.games.set(engine.id, engine);
    roomService.setStatus(room.code, 'playing', engine.id);
    this.scheduleTurnTimer(engine);

    logger.info('Game started', {
      gameId: engine.id,
      room: room.code,
      players: room.players.length,
      mode: room.mode,
    });
    return engine;
  }

  get(gameId: string): GameEngine | undefined {
    return this.games.get(gameId);
  }

  require(gameId: string): GameEngine {
    const engine = this.games.get(gameId);
    if (!engine) throw notFound(ERROR_CODES.GAME_NOT_FOUND, 'That game is no longer running.');
    return engine;
  }

  /** The live game a user is seated at, if any. Used for reconnection. */
  findByPlayer(userId: string): GameEngine | undefined {
    for (const engine of this.games.values()) {
      if (engine.state.status !== 'finished' && engine.player(userId)) return engine;
    }
    return undefined;
  }

  activeCount(): number {
    let count = 0;
    for (const engine of this.games.values()) if (engine.state.status === 'playing') count++;
    return count;
  }

  /* ------------------------------- actions -------------------------------- */

  playCard(gameId: string, playerId: string, cardId: string, chosenColor?: PlayableColor): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.playCard(playerId, cardId, chosenColor));
  }

  drawCard(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.drawCard(playerId));
  }

  chooseColor(gameId: string, playerId: string, color: PlayableColor): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.chooseColor(playerId, color));
  }

  callUno(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.callUno(playerId));
  }

  pass(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.pass(playerId));
  }

  catchUno(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.catchUno(playerId));
  }

  acceptDrawFour(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.acceptDrawFour(playerId));
  }

  challengeDrawFour(gameId: string, playerId: string): void {
    const engine = this.require(gameId);
    this.dispatch(engine, engine.challengeDrawFour(playerId));
  }

  /* ----------------------------- presence --------------------------------- */

  handleConnect(userId: string, socketId: string): GameEngine | undefined {
    const engine = this.findByPlayer(userId);
    if (!engine) return undefined;

    const timer = this.disconnectTimers.get(`${engine.id}:${userId}`);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(`${engine.id}:${userId}`);
    }

    engine.setConnection(userId, true, socketId);
    const player = engine.player(userId);
    logger.info('Player reconnected', { gameId: engine.id, player: player?.username });

    this.io?.to(gameRoomKey(engine.id)).emit('player_reconnected', {
      playerId: userId,
      username: player?.username ?? 'Player',
    });
    this.broadcastState(engine);
    return engine;
  }

  handleDisconnect(userId: string): void {
    const engine = this.findByPlayer(userId);
    if (!engine) return;

    engine.setConnection(userId, false);
    const player = engine.player(userId);
    logger.info('Player disconnected', { gameId: engine.id, player: player?.username });

    this.io?.to(gameRoomKey(engine.id)).emit('player_disconnected', {
      playerId: userId,
      username: player?.username ?? 'Player',
      graceSeconds: config.game.reconnectGraceSeconds,
    });
    this.broadcastState(engine);

    const key = `${engine.id}:${userId}`;
    const existing = this.disconnectTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key);
      this.handleGraceExpired(engine.id, userId);
    }, config.game.reconnectGraceSeconds * 1000);
    timer.unref?.();
    this.disconnectTimers.set(key, timer);
  }

  /**
   * The grace period lapsed. A single remaining player wins by default; otherwise
   * the table plays on and the absent seat is auto-played by the turn clock.
   */
  private handleGraceExpired(gameId: string, userId: string): void {
    const engine = this.games.get(gameId);
    if (!engine || engine.isFinished) return;

    const connected = engine.connectedPlayers();
    if (connected.length === 0) {
      logger.warn('Game abandoned by every player', { gameId });
      this.dispatch(engine, engine.finishGame(null));
      return;
    }
    if (connected.length === 1) {
      logger.info('Game awarded by abandonment', { gameId, winner: connected[0].username });
      this.dispatch(engine, engine.finishGame(connected[0].id));
      return;
    }

    // Still a real game: keep the absent player seated so they can return.
    void userId;
    this.broadcastState(engine);
  }

  /* ------------------------------ matchmaking ----------------------------- */

  enqueueForQuickMatch(userId: string): { position: number; size: number } {
    this.matchmakingQueue.delete(userId);
    this.matchmakingQueue.set(userId, Date.now());
    this.tryFormMatch();
    const ids = [...this.matchmakingQueue.keys()];
    return { position: Math.max(1, ids.indexOf(userId) + 1), size: ids.length };
  }

  dequeueFromQuickMatch(userId: string): void {
    this.matchmakingQueue.delete(userId);
    this.broadcastQueue();
  }

  queueSize(): number {
    return this.matchmakingQueue.size;
  }

  /**
   * Pairs the two longest-waiting players into a fresh room. Matchmaking state is
   * process-local by design (no Redis, no database) - see README "Known limitations".
   */
  private tryFormMatch(): void {
    const needed = config.game.minPlayers;
    while (this.matchmakingQueue.size >= needed) {
      const ids = [...this.matchmakingQueue.keys()].slice(0, needed);
      const seats: Array<{ id: string; username: string; avatar?: string }> = [];

      for (const id of ids) {
        this.matchmakingQueue.delete(id);
        const sockets = this.socketsForUser(id);
        const user = sockets[0]?.data?.user;
        if (user) seats.push({ id: user.id, username: user.username, avatar: user.avatar });
      }

      if (seats.length < needed) {
        // Someone vanished between queueing and matching; put the rest back.
        for (const seat of seats) this.matchmakingQueue.set(seat.id, Date.now());
        return;
      }

      const [host, ...rest] = seats;
      const room = roomService.create(host, {
        name: 'Quick Match',
        maxPlayers: needed,
        mode: 'classic',
        isPrivate: true,
      });
      for (const player of rest) roomService.join(room.code, player);
      for (const player of room.players) roomService.setReady(room.code, player.id, true);

      logger.info('Quick match formed', { code: room.code, players: room.players.map((p) => p.username) });
      for (const seat of seats) {
        this.io?.to(userRoomKey(seat.id)).emit('match_found', { roomCode: room.code });
      }
      this.io?.to(lobbyRoomKey()).emit('room_updated', { room });
    }
    this.broadcastQueue();
  }

  private broadcastQueue(): void {
    const ids = [...this.matchmakingQueue.keys()];
    ids.forEach((id, index) => {
      this.io?.to(userRoomKey(id)).emit('queue_update', {
        position: index + 1,
        size: ids.length,
        needed: config.game.minPlayers,
      });
    });
  }

  private socketsForUser(userId: string) {
    if (!this.io) return [];
    const room = this.io.sockets.adapter.rooms.get(userRoomKey(userId));
    if (!room) return [];
    return [...room].map((socketId) => this.io!.sockets.sockets.get(socketId)).filter(Boolean) as Array<{
      data?: SocketData;
    }>;
  }

  /* ------------------------------ broadcasting ---------------------------- */

  /** Sends each player their own, hand-private view of the game. */
  broadcastState(engine: GameEngine): void {
    if (!this.io) return;
    for (const player of engine.state.players) {
      this.io.to(userRoomKey(player.id)).emit('game_state_updated', { state: engine.stateFor(player.id) });
    }
  }

  private dispatch(engine: GameEngine, result: EngineResult): void {
    for (const event of result.events) this.emitEvent(engine, event);
    this.broadcastState(engine);
    this.scheduleTurnTimer(engine);
    this.scheduleUnoTimer(engine);
  }

  private emitEvent(engine: GameEngine, event: EngineEvent): void {
    const io = this.io;
    if (!io) return;
    const room = io.to(gameRoomKey(engine.id));

    switch (event.type) {
      case 'card_played':
        room.emit('card_played', { action: event.action });
        break;
      case 'card_drawn':
        room.emit('card_drawn', { playerId: event.playerId, username: event.username, count: event.count });
        break;
      case 'color_changed':
        room.emit('color_changed', { color: event.color, playerId: event.playerId });
        break;
      case 'color_choice_required':
        // The chooser learns this from their own state; nothing extra to fan out.
        break;
      case 'uno_called':
        room.emit('uno_called', { playerId: event.playerId, username: event.username });
        break;
      case 'uno_penalty':
        room.emit('uno_penalty', {
          playerId: event.playerId,
          username: event.username,
          cards: event.cards,
          caughtBy: event.caughtBy,
        });
        break;
      case 'turn_passed':
        room.emit('turn_passed', { playerId: event.playerId, username: event.username });
        break;
      case 'draw_four_challenge':
        room.emit('draw_four_challenge', {
          challengerId: event.challengerId,
          challengerName: event.challengerName,
          accusedId: event.accusedId,
          accusedName: event.accusedName,
          wasBluff: event.wasBluff,
          cards: event.cards,
        });
        break;
      case 'turn_changed':
        room.emit('turn_changed', { currentPlayerId: event.currentPlayerId, deadline: event.deadline });
        break;
      case 'game_finished':
        this.onGameFinished(engine, event);
        break;
    }
  }

  private onGameFinished(
    engine: GameEngine,
    event: Extract<EngineEvent, { type: 'game_finished' }>,
  ): void {
    this.clearTimers(engine.id);

    const io = this.io;
    io?.to(gameRoomKey(engine.id)).emit('game_finished', {
      gameId: engine.id,
      winnerId: event.winnerId,
      winnerUsername: event.winnerUsername,
      results: event.results,
      durationMs: event.durationMs,
    });
    if (event.winnerId && event.winnerUsername) {
      io?.to(gameRoomKey(engine.id)).emit('player_won', {
        gameId: engine.id,
        winnerId: event.winnerId,
        winnerUsername: event.winnerUsername,
      });
    }

    logger.info('Game finished', { gameId: engine.id, winner: event.winnerUsername ?? 'none' });

    const room = roomService.getById(engine.state.roomId);
    const mode = room?.mode ?? 'classic';
    if (room) {
      try {
        roomService.setStatus(room.code, 'finished');
      } catch {
        /* room may already be gone */
      }
    }

    void historyService
      .persistFinishedGame({
        state: engine.state,
        results: event.results,
        winnerId: event.winnerId,
        durationMs: event.durationMs,
        mode,
      })
      .then(() => leaderboardService.invalidate())
      .catch((error: Error) => logger.error('History persistence failed', { message: error.message }));

    // Keep the finished game around briefly so late reconnects still see the result.
    const cleanup = setTimeout(() => this.games.delete(engine.id), 5 * 60 * 1000);
    cleanup.unref?.();
  }

  /* --------------------------------- timers -------------------------------- */

  private timersFor(gameId: string): GameTimers {
    let entry = this.timers.get(gameId);
    if (!entry) {
      entry = {};
      this.timers.set(gameId, entry);
    }
    return entry;
  }

  private scheduleTurnTimer(engine: GameEngine): void {
    const timers = this.timersFor(engine.id);
    if (timers.turn) clearTimeout(timers.turn);
    timers.turn = undefined;

    if (engine.isFinished || !engine.state.turnDeadline) return;
    const delay = Math.max(500, engine.state.turnDeadline - Date.now());

    const timer = setTimeout(() => {
      const live = this.games.get(engine.id);
      if (!live || live.isFinished) return;
      try {
        logger.info('Turn timed out', { gameId: live.id });
        this.dispatch(live, live.handleTurnTimeout());
      } catch (error) {
        logger.error('Turn timeout handling failed', { gameId: live.id, message: (error as Error).message });
      }
    }, delay);
    timer.unref?.();
    timers.turn = timer;
  }

  private scheduleUnoTimer(engine: GameEngine): void {
    const timers = this.timersFor(engine.id);
    if (timers.uno) clearTimeout(timers.uno);
    timers.uno = undefined;

    // Only the house-rule automatic penalty needs a timer; under the official
    // rule a missed UNO is punished by another player catching it, not by us.
    const pending = engine.state.unoVulnerable;
    if (engine.isFinished || !pending?.deadline) return;
    const deadline = pending.deadline;

    const timer = setTimeout(() => {
      const live = this.games.get(engine.id);
      if (!live || live.isFinished) return;
      const result = live.resolveUnoPenalty(pending.playerId);
      if (result.events.length) this.dispatch(live, result);
    }, Math.max(500, deadline - Date.now()));
    timer.unref?.();
    timers.uno = timer;
  }

  private clearTimers(gameId: string): void {
    const timers = this.timers.get(gameId);
    if (timers?.turn) clearTimeout(timers.turn);
    if (timers?.uno) clearTimeout(timers.uno);
    this.timers.delete(gameId);
  }

  /** Test seam / graceful shutdown. */
  shutdown(): void {
    for (const gameId of [...this.timers.keys()]) this.clearTimers(gameId);
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.games.clear();
    this.matchmakingQueue.clear();
  }
}

export const gameManager = new GameManager();
