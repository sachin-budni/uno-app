import type { Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, ServerToClientEvents, SocketData } from '../models/socket.model';
import { toGameError } from '../utils/errors';
import { logger } from '../utils/logger';

export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const roomChannel = (code: string) => `room:${code}`;

/**
 * Runs a socket handler, turning any thrown AppError into both an ack response
 * and a `game_error` event, so the UI can react whichever one it listens to.
 */
export async function handleEvent<T>(
  socket: AppSocket,
  ack: Ack<T> | undefined,
  run: () => T | Promise<T>,
): Promise<void> {
  try {
    const data = await run();
    ack?.({ ok: true, data });
  } catch (error) {
    const payload = toGameError(error);
    if (payload.code === 'INTERNAL_ERROR') {
      logger.error('Socket handler crashed', { message: (error as Error).message, stack: (error as Error).stack });
    } else {
      logger.warn('Invalid socket action', { code: payload.code, user: socket.data.user?.username });
    }
    ack?.({ ok: false, error: payload });
    socket.emit('game_error', payload);
  }
}

/**
 * Small token bucket so one client cannot flood the server with events.
 * Deliberately generous: it stops abuse, not fast play.
 */
export class RateBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond);
    this.lastRefill = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
