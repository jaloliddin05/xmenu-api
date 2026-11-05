import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** An id from the proxy is kept only if it looks like one (it ends up in logs). */
const INCOMING_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

type WithRequestId = Request & { requestId?: string };

/**
 * Every request gets an id: the X-Request-Id of the proxy, or a new UUID. It is sent back in the
 * X-Request-Id header and in every error body, and log lines of failed requests carry it.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && INCOMING_ID_RE.test(incoming)
      ? incoming
      : randomUUID();
  (req as WithRequestId).requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/** The request's id (set by requestIdMiddleware; created here when the middleware did not run). */
export function requestIdOf(req: Request | undefined, res: Response): string {
  const known = (req as WithRequestId | undefined)?.requestId;
  if (known) return known;
  const id = randomUUID();
  if (req) (req as WithRequestId).requestId = id;
  if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
