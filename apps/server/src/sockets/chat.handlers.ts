import type { Server } from 'socket.io';
import { parseOrThrow } from '../middleware/validate';
import { socketChatSchema } from '../models/schemas';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../models/socket.model';
import { chatService } from '../services/chat.service';
import { roomService } from '../services/room.service';
import { ERROR_CODES, badRequest } from '../utils/errors';
import { handleEvent, RateBucket, roomChannel, type AppSocket } from './helpers';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function registerChatHandlers(io: IO, socket: AppSocket): void {
  const user = socket.data.user;
  // 5 messages burst, then one per second.
  const bucket = new RateBucket(5, 1);

  socket.on('send_chat_message', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketChatSchema, payload);

      const room = roomService.require(input.roomCode);
      if (!room.players.some((player) => player.id === user.id)) {
        throw badRequest(ERROR_CODES.NOT_IN_ROOM, 'You can only chat in a room you are in.');
      }
      if (!bucket.take()) {
        throw badRequest(ERROR_CODES.RATE_LIMITED, 'You are sending messages too quickly.');
      }

      const message = chatService.add(room.code, {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        text: input.text,
      });
      if (!message.text) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Type a message first.');

      io.to(roomChannel(room.code)).emit('chat_message', message);
      return { sent: true as const };
    }),
  );
}
