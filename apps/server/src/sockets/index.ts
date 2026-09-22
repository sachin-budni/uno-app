import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { corsOrigin } from '../config/app';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../models/socket.model';
import { chatService } from '../services/chat.service';
import { gameManager, gameRoomKey, lobbyRoomKey, userRoomKey } from '../services/game-manager';
import { roomService } from '../services/room.service';
import { logger } from '../utils/logger';
import { registerChatHandlers } from './chat.handlers';
import { registerGameHandlers } from './game.handlers';
import { broadcastLobbyStats, registerRoomHandlers } from './room.handlers';
import { authenticateSocket } from './socket-auth';
import { roomChannel, type AppSocket } from './helpers';

export type AppIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function createSocketServer(httpServer: HttpServer): AppIO {
  const io: AppIO = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    // Generous enough for a phone switching networks, short enough to notice a drop.
    pingTimeout: 20_000,
    pingInterval: 25_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 60_000,
      skipMiddlewares: false,
    },
  });

  io.use(authenticateSocket);
  gameManager.attach(io);

  io.on('connection', (socket: AppSocket) => {
    const user = socket.data.user;
    logger.info('Player connected', { player: user.username, socketId: socket.id });

    // Personal channel: every device this player has open receives their state.
    void socket.join(userRoomKey(user.id));
    void socket.join(lobbyRoomKey());

    registerRoomHandlers(io, socket);
    registerGameHandlers(socket);
    registerChatHandlers(io, socket);

    restoreSession(io, socket);
    broadcastLobbyStats(io);

    socket.on('disconnect', (reason) => {
      logger.info('Player disconnected', { player: user.username, reason });

      // Only treat it as gone when this was their last open socket.
      const remaining = io.sockets.adapter.rooms.get(userRoomKey(user.id))?.size ?? 0;
      if (remaining === 0) {
        gameManager.handleDisconnect(user.id);
        gameManager.dequeueFromQuickMatch(user.id);

        for (const code of socket.data.rooms) {
          const room = roomService.setConnection(code, user.id, false);
          if (room) io.to(roomChannel(code)).emit('room_updated', { room });
        }
      }
      broadcastLobbyStats(io);
    });
  });

  return io;
}

/**
 * Re-attaches a returning player to whatever they were doing: their waiting room,
 * their live game, or both. This is what makes a browser refresh a non-event.
 */
function restoreSession(io: AppIO, socket: AppSocket): void {
  const user = socket.data.user;

  const room = roomService.findByPlayer(user.id);
  if (room) {
    roomService.setConnection(room.code, user.id, true);
    void socket.join(roomChannel(room.code));
    socket.data.rooms.add(room.code);
    socket.emit('room_updated', { room });
    for (const message of chatService.recent(room.code)) socket.emit('chat_message', message);
    io.to(roomChannel(room.code)).emit('room_updated', { room });
  }

  const engine = gameManager.handleConnect(user.id, socket.id);
  if (engine) {
    void socket.join(gameRoomKey(engine.id));
    socket.emit('game_state_updated', { state: engine.stateFor(user.id) });
  }
}
