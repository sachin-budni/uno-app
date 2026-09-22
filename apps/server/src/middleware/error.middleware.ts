import type { NextFunction, Request, Response } from 'express';
import { AppError, ERROR_CODES } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: ERROR_CODES.NOT_FOUND, message: `No route matches ${req.method} ${req.originalUrl}.` },
  });
}

/** Every error leaves the API in the same envelope: { error: { code, message } }. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error('Request failed', { path: req.originalUrl, code: error.code, message: error.message });
    } else {
      logger.warn('Request rejected', { path: req.originalUrl, code: error.code });
    }
    res.status(error.status).json({ error: error.toJSON() });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error('Unhandled request error', { path: req.originalUrl, message });
  res.status(500).json({
    error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Something went wrong on our side.' },
  });
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
