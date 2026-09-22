import type { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import { verifyAccessToken } from '../services/token.service';
import { userService } from '../services/user.service';
import { logger } from '../utils/logger';

/**
 * Every socket must present the same JWT the REST API expects. The identity that
 * results is the *only* identity the rest of the server will trust - handlers
 * never read a player id out of an event payload.
 */
export async function authenticateSocket(socket: Socket, next: (err?: ExtendedError) => void): Promise<void> {
  const raw =
    (socket.handshake.auth as { token?: string } | undefined)?.token ??
    (typeof socket.handshake.query.token === 'string' ? socket.handshake.query.token : undefined);

  if (!raw) {
    const error = new Error('Authentication required.') as ExtendedError;
    error.data = { code: 'NOT_AUTHORIZED' };
    return next(error);
  }

  try {
    const payload = verifyAccessToken(raw);
    // Re-read the profile so a renamed or deleted account cannot keep playing
    // under a stale token claim.
    const user = await userService.findById(payload.sub);
    if (!user) {
      const error = new Error('Your account no longer exists.') as ExtendedError;
      error.data = { code: 'USER_NOT_FOUND' };
      return next(error);
    }

    socket.data.user = { id: user.id, username: user.username, avatar: user.avatar };
    socket.data.rooms = new Set<string>();
    next();
  } catch (error) {
    logger.warn('Socket authentication rejected', { message: (error as Error).message });
    const wrapped = new Error('Your session is not valid. Please sign in again.') as ExtendedError;
    wrapped.data = { code: 'NOT_AUTHORIZED' };
    next(wrapped);
  }
}
