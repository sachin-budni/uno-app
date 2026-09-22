import { config } from '../config/env';
import { GAME_MODES, type GameMode, type Room, type RoomStatus } from '../models/room.model';
import { ERROR_CODES, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { logger } from '../utils/logger';
import { generateRoomCode, newId } from '../utils/random';
import { sanitizeText } from '../utils/sanitize';
import { db } from './db.service';

export interface CreateRoomInput {
  name: string;
  maxPlayers: number;
  mode: GameMode;
  isPrivate: boolean;
}

export interface RoomUser {
  id: string;
  username: string;
  avatar?: string;
}

/**
 * Rooms are authoritative in memory - that is what the sockets read and write on
 * every keystroke-speed interaction. A copy is written through to JSON Server so
 * the REST API and any future dashboard can see them, but the file is never on
 * the hot path of a join or a ready toggle.
 */
class RoomService {
  private readonly rooms = new Map<string, Room>();
  private cleanupTimer?: NodeJS.Timeout;
  /** Rooms with no connected player since this timestamp. */
  private readonly emptySince = new Map<string, number>();

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupAbandoned(), 60_000);
    this.cleanupTimer.unref?.();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  list(includePrivate = false): Room[] {
    return [...this.rooms.values()]
      .filter((room) => room.status !== 'closed' && (includePrivate || !room.isPrivate))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Rooms a newcomer could actually join right now. */
  listJoinable(): Room[] {
    return this.list(false).filter((room) => room.status === 'waiting' && room.players.length < room.maxPlayers);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(this.normalize(code));
  }

  require(code: string): Room {
    const room = this.get(code);
    if (!room || room.status === 'closed') {
      throw notFound(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not match an open room.');
    }
    return room;
  }

  getById(id: string): Room | undefined {
    return [...this.rooms.values()].find((room) => room.id === id);
  }

  /** The room a given user currently occupies, if any. */
  findByPlayer(userId: string): Room | undefined {
    return [...this.rooms.values()].find(
      (room) => room.status !== 'closed' && room.players.some((player) => player.id === userId),
    );
  }

  create(host: RoomUser, input: CreateRoomInput): Room {
    const name = sanitizeText(input.name, 40) || `${host.username}'s table`;
    const maxPlayers = Math.min(Math.max(Math.trunc(input.maxPlayers), 2), config.game.maxPlayers);
    const mode: GameMode = GAME_MODES.includes(input.mode) ? input.mode : 'classic';

    // Leaving any previous room keeps a player from occupying two seats.
    const previous = this.findByPlayer(host.id);
    if (previous) this.leave(previous.code, host.id);

    const now = new Date().toISOString();
    const room: Room = {
      id: newId(),
      code: this.uniqueCode(),
      name,
      hostId: host.id,
      maxPlayers,
      mode,
      isPrivate: !!input.isPrivate,
      status: 'waiting',
      players: [
        {
          id: host.id,
          username: host.username,
          avatar: host.avatar,
          isReady: false,
          isConnected: true,
          isHost: true,
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(room.code, room);
    this.persist(room, 'create');
    logger.info('Room created', { code: room.code, host: host.username, mode, maxPlayers });
    return room;
  }

  join(code: string, user: RoomUser): Room {
    const room = this.require(code);

    const existing = room.players.find((player) => player.id === user.id);
    if (existing) {
      // Re-joining from a refresh or a second tab is a reconnect, not an error.
      existing.isConnected = true;
      existing.username = user.username;
      existing.avatar = user.avatar;
      return this.touch(room);
    }

    if (room.status !== 'waiting') {
      throw conflict(ERROR_CODES.GAME_ALREADY_STARTED, 'That game has already started.');
    }
    if (room.players.length >= room.maxPlayers) {
      throw conflict(ERROR_CODES.ROOM_FULL, 'That room is already full.');
    }

    const elsewhere = this.findByPlayer(user.id);
    if (elsewhere && elsewhere.code !== room.code) this.leave(elsewhere.code, user.id);

    room.players.push({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      isReady: false,
      isConnected: true,
      isHost: false,
      joinedAt: new Date().toISOString(),
    });

    logger.info('Player joined room', { code: room.code, player: user.username });
    return this.touch(room);
  }

  leave(code: string, userId: string): Room | null {
    const room = this.get(code);
    if (!room) return null;

    const index = room.players.findIndex((player) => player.id === userId);
    if (index === -1) return room;

    const [removed] = room.players.splice(index, 1);
    logger.info('Player left room', { code: room.code, player: removed.username });

    if (room.players.length === 0) {
      this.close(room.code, 'empty');
      return null;
    }

    // Hand the host badge to whoever has been waiting longest.
    if (removed.isHost) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
    }

    return this.touch(room);
  }

  setReady(code: string, userId: string, isReady: boolean): Room {
    const room = this.require(code);
    const player = room.players.find((candidate) => candidate.id === userId);
    if (!player) throw forbidden('You are not in that room.', ERROR_CODES.NOT_IN_ROOM);
    if (room.status !== 'waiting') {
      throw conflict(ERROR_CODES.GAME_ALREADY_STARTED, 'The game is already underway.');
    }
    player.isReady = isReady;
    return this.touch(room);
  }

  setConnection(code: string, userId: string, isConnected: boolean): Room | undefined {
    const room = this.get(code);
    if (!room) return undefined;
    const player = room.players.find((candidate) => candidate.id === userId);
    if (!player) return room;
    player.isConnected = isConnected;
    if (!isConnected) player.isReady = false;
    return this.touch(room);
  }

  /** Validates that this user may start this room right now. */
  assertCanStart(code: string, userId: string): Room {
    const room = this.require(code);
    if (room.hostId !== userId) throw forbidden('Only the host can start the game.', ERROR_CODES.NOT_HOST);
    if (room.status === 'playing') throw conflict(ERROR_CODES.GAME_ALREADY_STARTED, 'The game is already running.');
    if (room.players.length < config.game.minPlayers) {
      throw badRequest(
        ERROR_CODES.NOT_ENOUGH_PLAYERS,
        `You need at least ${config.game.minPlayers} players to start.`,
      );
    }
    const notReady = room.players.filter((player) => !player.isReady);
    if (notReady.length > 0) {
      throw badRequest(
        ERROR_CODES.PLAYER_NOT_READY,
        `Waiting for ${notReady.map((player) => player.username).join(', ')} to get ready.`,
      );
    }
    return room;
  }

  setStatus(code: string, status: RoomStatus, gameId?: string): Room {
    const room = this.require(code);
    room.status = status;
    if (gameId !== undefined) room.gameId = gameId;
    const updated = this.touch(room);
    this.persist(updated, 'status');
    return updated;
  }

  /** Puts a finished room back into the waiting state so the table can rematch. */
  resetForRematch(code: string): Room {
    const room = this.require(code);
    room.status = 'waiting';
    room.gameId = undefined;
    for (const player of room.players) player.isReady = false;
    const updated = this.touch(room);
    this.persist(updated, 'status');
    return updated;
  }

  close(code: string, reason: string): void {
    const room = this.get(code);
    if (!room) return;
    room.status = 'closed';
    room.updatedAt = new Date().toISOString();
    this.rooms.delete(room.code);
    this.emptySince.delete(room.code);
    this.persist(room, 'status');
    logger.info('Room closed', { code: room.code, reason });
  }

  /** Updates the handful of fields a host is allowed to change after creation. */
  updateSettings(code: string, userId: string, patch: { name?: string; isPrivate?: boolean }): Room {
    const room = this.require(code);
    if (room.hostId !== userId) throw forbidden('Only the host can change room settings.', ERROR_CODES.NOT_HOST);
    if (room.status !== 'waiting') {
      throw conflict(ERROR_CODES.GAME_ALREADY_STARTED, 'Settings are locked once the game starts.');
    }
    if (patch.name !== undefined) {
      const name = sanitizeText(patch.name, 40);
      if (name.length < 3) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Room names need at least 3 characters.');
      room.name = name;
    }
    if (patch.isPrivate !== undefined) room.isPrivate = !!patch.isPrivate;
    const updated = this.touch(room);
    this.persist(updated, 'status');
    return updated;
  }

  stats(): { openRooms: number; activeRooms: number } {
    const rooms = [...this.rooms.values()];
    return {
      openRooms: rooms.filter((room) => room.status === 'waiting').length,
      activeRooms: rooms.filter((room) => room.status === 'playing').length,
    };
  }

  /* ------------------------------- internals ------------------------------- */

  private cleanupAbandoned(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const hasConnected = room.players.some((player) => player.isConnected);
      if (hasConnected || room.status === 'playing') {
        this.emptySince.delete(room.code);
        continue;
      }
      const since = this.emptySince.get(room.code) ?? now;
      this.emptySince.set(room.code, since);
      if (now - since >= config.game.abandonedRoomTtlMs) {
        this.close(room.code, 'abandoned');
      }
    }
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    return `${generateRoomCode()}${Date.now().toString(36).slice(-2).toUpperCase()}`;
  }

  private normalize(code: string): string {
    return (code ?? '').trim().toUpperCase();
  }

  private touch(room: Room): Room {
    room.updatedAt = new Date().toISOString();
    return room;
  }

  /**
   * Write-through to JSON Server. Deliberately fire-and-forget: a persistence
   * hiccup must never break a live table, so failures are logged, not thrown.
   */
  private persist(room: Room, kind: 'create' | 'status'): void {
    const snapshot: Room = JSON.parse(JSON.stringify(room));
    const write =
      kind === 'create' ? db.create('rooms', snapshot) : db.replace('rooms', snapshot).catch(() => db.create('rooms', snapshot));
    Promise.resolve(write).catch((error: Error) => {
      logger.warn('Could not persist room snapshot', { code: room.code, message: error.message });
    });
  }

  /** Test seam. */
  clear(): void {
    this.rooms.clear();
    this.emptySince.clear();
  }

  /** Restores rooms from a snapshot (used by tests). */
  hydrate(rooms: Room[]): void {
    for (const room of rooms) this.rooms.set(room.code, room);
  }
}

export const roomService = new RoomService();
