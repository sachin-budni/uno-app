import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';
import { ERROR_CODES, unauthorized } from '../utils/errors';

export interface TokenPayload {
  sub: string;
  username: string;
  avatar: string;
}

export function signAccessToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === 'string' || !decoded.sub) {
      throw unauthorized('Your session is not valid. Please sign in again.');
    }
    return {
      sub: String(decoded.sub),
      username: String((decoded as Record<string, unknown>).username ?? ''),
      avatar: String((decoded as Record<string, unknown>).avatar ?? 'fox'),
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('Your session has expired. Please sign in again.', ERROR_CODES.TOKEN_EXPIRED);
    }
    throw unauthorized('Your session is not valid. Please sign in again.');
  }
}

/** Pulls a bearer token out of an Authorization header. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}
