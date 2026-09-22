/**
 * Every failure that can reach a client is one of these codes. The Angular client
 * maps them to friendly copy, so the code is part of the public contract.
 */
export const ERROR_CODES = {
  // auth / access
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',

  // rooms
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CLOSED: 'ROOM_CLOSED',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  GAME_ALREADY_STARTED: 'GAME_ALREADY_STARTED',
  PLAYER_NOT_READY: 'PLAYER_NOT_READY',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',

  // gameplay
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  GAME_FINISHED: 'GAME_FINISHED',
  GAME_NOT_STARTED: 'GAME_NOT_STARTED',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  CARD_NOT_IN_HAND: 'CARD_NOT_IN_HAND',
  INVALID_CARD: 'INVALID_CARD',
  INVALID_COLOR: 'INVALID_COLOR',
  COLOR_REQUIRED: 'COLOR_REQUIRED',
  NO_COLOR_PENDING: 'NO_COLOR_PENDING',
  WILD_DRAW_FOUR_ILLEGAL: 'WILD_DRAW_FOUR_ILLEGAL',
  INVALID_UNO_CALL: 'INVALID_UNO_CALL',
  INVALID_UNO_CATCH: 'INVALID_UNO_CATCH',
  MUST_RESOLVE_DRAW: 'MUST_RESOLVE_DRAW',
  MUST_PLAY_OR_PASS: 'MUST_PLAY_OR_PASS',
  CANNOT_PASS: 'CANNOT_PASS',
  CHALLENGE_PENDING: 'CHALLENGE_PENDING',
  NO_CHALLENGE_PENDING: 'NO_CHALLENGE_PENDING',
  NOT_CHALLENGE_TARGET: 'NOT_CHALLENGE_TARGET',
  PLAYER_NOT_IN_GAME: 'PLAYER_NOT_IN_GAME',

  // infrastructure
  PERSISTENCE_UNAVAILABLE: 'PERSISTENCE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface GameErrorShape {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/** Thrown anywhere in the server; serialised identically over HTTP and Socket.IO. */
export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode | string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON(): GameErrorShape {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(code, message, 400, details);
export const unauthorized = (message = 'You are not signed in.', code: ErrorCode = ERROR_CODES.NOT_AUTHORIZED) =>
  new AppError(code, message, 401);
export const forbidden = (message = 'You are not allowed to do that.', code: ErrorCode = ERROR_CODES.NOT_AUTHORIZED) =>
  new AppError(code, message, 403);
export const notFound = (code: ErrorCode, message: string) => new AppError(code, message, 404);
export const conflict = (code: ErrorCode, message: string) => new AppError(code, message, 409);
export const internal = (message = 'Something went wrong on our side.', details?: unknown) =>
  new AppError(ERROR_CODES.INTERNAL_ERROR, message, 500, details);

export function toGameError(error: unknown): GameErrorShape {
  if (error instanceof AppError) return error.toJSON();
  return { code: ERROR_CODES.INTERNAL_ERROR, message: 'Something went wrong on our side.' };
}
