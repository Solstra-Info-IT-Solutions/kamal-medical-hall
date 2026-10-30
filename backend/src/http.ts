import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { config } from './config.js';
import { reportError } from './monitoring.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const bad = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);

/** Where a phone's browser can open a link this API hands out: PUBLIC_URL, else the address the request came in on. */
export const publicBase = (req: Request) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(422, 'validation_failed', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const requestId = res.locals.requestId as string | undefined;
  if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } });
  if (error instanceof ZodError) return res.status(422).json({ error: { code: 'validation_failed', message: 'Some of the information sent was not valid.', requestId } });
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', id: requestId, error: error instanceof Error ? error.message : String(error) }));
  reportError(error);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.', requestId } });
}
