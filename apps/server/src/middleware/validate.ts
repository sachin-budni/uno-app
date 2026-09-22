import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ERROR_CODES, badRequest } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

export interface FieldIssue {
  field: string;
  message: string;
}

export function formatZodError(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_',
    message: issue.message,
  }));
}

/** Parses and *replaces* the request section with the validated, typed value. */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        badRequest(ERROR_CODES.VALIDATION_ERROR, 'Please check the highlighted fields.', formatZodError(result.error)),
      );
    }
    if (source === 'body') req.body = result.data;
    else Object.defineProperty(req, source, { value: result.data, writable: true });
    next();
  };
}

/** Same validation, for socket payloads (which have no Express plumbing). */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'That request was not valid.', formatZodError(result.error));
  }
  return result.data;
}
