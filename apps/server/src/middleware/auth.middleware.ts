import type { NextFunction, Request, Response } from 'express';
import { bearerFrom, verifyAccessToken, type TokenPayload } from '../services/token.service';
import { unauthorized } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

/** Rejects the request unless it carries a valid, unexpired access token. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerFrom(req.headers.authorization);
  if (!token) return next(unauthorized());
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches the caller when a token is present, but never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerFrom(req.headers.authorization);
  if (!token) return next();
  try {
    req.auth = verifyAccessToken(token);
  } catch {
    /* an invalid token simply means "anonymous" here */
  }
  next();
}
