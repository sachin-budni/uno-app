import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../models/socket.model';
import {
  createRoomSchema,
  joinRoomSchema,
  socketRoomSchema,
} from '../models/schemas';
import { parseOrThrow } from '../middleware/validate';
import { chatService } from '../services/chat.service';
import { gameManager, gameRoomKey, lobbyRoomKey, userRoomKey } from '../services/game-manager';
import { roomService } from '../services/room.service';
import { ERROR_CODES, badRequest } from '../utils/errors';
import { logger } from '../utils/logger';
import { handleEvent, roomChannel, type AppSocket } from './helpers';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function broadcastLobbyStats(io: IO): void {
  const rooms = roomService.stats();
  io.to(lobbyRoomKey()).emit('lobby_stats', {
    onlinePlayers: io.sockets.adapter.rooms.size ? countOnlinePlayers(io) : 0,
    activeGames: gameManager.activeCount(),
    openRooms: rooms.openRooms,
  });
}

/** Distinct authenticated users, not sockets - two tabs are still one player. */
function countOnlinePlayers(io: IO): number {
  const users = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    const id = socket.data?.user?.id;
    if (id) users.add(id);
  }
  return users.size;
}

export function registerRoomHandlers(io: IO, socket: AppSocket): void {
  const user = socket.data.user;

  const enterRoomChannel = (code: string) => {
    socket.join(roomChannel(code));
    socket.data.rooms.add(code);
  };

  socket.on('create_room', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(createRoomSchema, payload);
      const room = roomService.create(user, {
        name: input.name,
        maxPlayers: input.maxPlayers,
        mode: input.mode as 'classic' | 'fast' | 'stacking',
        isPrivate: input.isPrivate,
      });
      enterRoomChannel(room.code);
      socket.emit('room_created', { room });
      io.to(roomChannel(room.code)).emit('room_updated', { room });
      broadcastLobbyStats(io);
      return { room };
    }),
  );

  socket.on('join_room', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(joinRoomSchema, payload);
      const room = roomService.join(roomCode, user);
      enterRoomChannel(room.code);

      io.to(roomChannel(room.code)).emit('player_joined', {
        room,
        player: { id: user.id, username: user.username },
      });
      io.to(roomChannel(room.code)).emit('room_updated', { room });

      const joined = chatService.system(room.code, `${user.username} joined the table.`);
      io.to(roomChannel(room.code)).emit('chat_message', joined);
      for (const message of chatService.recent(room.code)) socket.emit('chat_message', message);

      broadcastLobbyStats(io);
      return { room };
    }),
  );

  socket.on('leave_room', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(socketRoomSchema, payload);
      const room = roomService.leave(roomCode, user.id);
      socket.leave(roomChannel(roomCode));
      socket.data.rooms.delete(roomCode);

      if (room) {
        io.to(roomChannel(roomCode)).emit('player_left', { room, playerId: user.id, username: user.username });
        io.to(roomChannel(roomCode)).emit('room_updated', { room });
        io.to(roomChannel(roomCode)).emit('chat_message', chatService.system(roomCode, `${user.username} left.`));
      } else {
        io.to(roomChannel(roomCode)).emit('room_closed', { roomCode, reason: 'Everyone left the table.' });
        chatService.clear(roomCode);
      }
      broadcastLobbyStats(io);
      return { left: true as const };
    }),
  );

  const setReady = (payload: unknown, ready: boolean, ack?: Parameters<ClientToServerEvents['player_ready']>[1]) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(socketRoomSchema, payload);
      const room = roomService.setReady(roomCode, user.id, ready);
      io.to(roomChannel(room.code)).emit('player_ready_changed', { room, playerId: user.id, isReady: ready });
      io.to(roomChannel(room.code)).emit('room_updated', { room });
      return { room };
    });

  socket.on('player_ready', (payload, ack) => setReady(payload, true, ack));
  socket.on('player_unready', (payload, ack) => setReady(payload, false, ack));

  socket.on('request_room_state', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(socketRoomSchema, payload);
      const room = roomService.require(roomCode);
      if (!room.players.some((player) => player.id === user.id)) {
        throw badRequest(ERROR_CODES.NOT_IN_ROOM, 'You are not in that room.');
      }
      enterRoomChannel(room.code);
      return { room };
    }),
  );

  socket.on('start_game', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(socketRoomSchema, payload);
      const room = roomService.assertCanStart(roomCode, user.id);

      const engine = gameManager.createGameForRoom(room);

      // Pull every seat's sockets (including other tabs) into the game channel.
      for (const player of room.players) {
        void io.in(userRoomKey(player.id)).socketsJoin(gameRoomKey(engine.id));
      }

      io.to(roomChannel(room.code)).emit('game_started', { gameId: engine.id, roomCode: room.code });
      io.to(roomChannel(room.code)).emit('room_updated', { room });
      io.to(roomChannel(room.code)).emit('chat_message', chatService.system(room.code, 'The game has started. Good luck!'));
      gameManager.broadcastState(engine);
      broadcastLobbyStats(io);

      return { gameId: engine.id };
    }),
  );

  socket.on('request_rematch', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const { roomCode } = parseOrThrow(socketRoomSchema, payload);
      const existing = roomService.require(roomCode);
      if (!existing.players.some((player) => player.id === user.id)) {
        throw badRequest(ERROR_CODES.NOT_IN_ROOM, 'You are not in that room.');
      }
      const room = roomService.resetForRematch(roomCode);
      io.to(roomChannel(room.code)).emit('room_updated', { room });
      io.to(roomChannel(room.code)).emit(
        'chat_message',
        chatService.system(room.code, `${user.username} wants a rematch. Ready up!`),
      );
      return { room };
    }),
  );

  /* ------------------------------ quick match ------------------------------ */

  socket.on('quick_match', (_payload, ack) =>
    handleEvent(socket, ack, () => {
      const { position, size } = gameManager.enqueueForQuickMatch(user.id);
      logger.info('Player queued for quick match', { player: user.username, size });
      return { queued: true, position };
    }),
  );

  socket.on('cancel_quick_match', (_payload, ack) =>
    handleEvent(socket, ack, () => {
      gameManager.dequeueFromQuickMatch(user.id);
      return { cancelled: true as const };
    }),
  );

}
