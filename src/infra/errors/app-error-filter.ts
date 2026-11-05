import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorMessage, errorStack } from '../helper/error-text';
import { AppException, FieldError } from './app-exception';
import {
  codeForStatus,
  ERROR_CODES,
  ErrorCode,
  isErrorCode,
} from './error-codes';
import { requestIdOf } from './request-id';

/** The body of every error response, in both the owner and the customer API. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  status: number;
  fields?: FieldError[];
  retryAfter?: number;
  details?: Record<string, unknown>;
  requestId: string;
}

interface LogEntry {
  level: 'error' | 'warn';
  text: string;
  stack?: string;
}

export interface DescribedError {
  body: Omit<ErrorBody, 'requestId'>;
  log?: LogEntry;
}

/** Express body-parser errors arrive as plain errors with `type` and `status`. */
function bodyParserCode(exception: unknown): ErrorCode | null {
  const type = (exception as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') return 'invalid_body';
  if (type === 'entity.too.large') return 'payload_too_large';
  return null;
}

/** Only the keys the registry allows for the code; the rest is reported for the log. */
function safeDetails(code: ErrorCode, details: Record<string, unknown>) {
  const allowed: readonly string[] =
    (ERROR_CODES[code] as { details?: readonly string[] }).details ?? [];
  const kept = Object.fromEntries(
    Object.entries(details).filter(([k]) => allowed.includes(k)),
  );
  const dropped = Object.keys(details).filter((k) => !allowed.includes(k));
  return { kept, dropped };
}

/**
 * Turns anything thrown into the response body and an optional log entry. Texts of exceptions,
 * external services and the database never reach the body: only the registry code, the AppException
 * message (written for developers) and the details the registry allows.
 */
export function describeError(exception: unknown): DescribedError {
  if (exception instanceof AppException) {
    const status = exception.getStatus();
    const body: DescribedError['body'] = {
      code: exception.code,
      message: exception.message,
      status,
    };
    if (exception.fields?.length) body.fields = exception.fields;
    if (exception.retryAfter !== undefined)
      body.retryAfter = exception.retryAfter;
    const notes: string[] = [];
    if (exception.details) {
      const { kept, dropped } = safeDetails(exception.code, exception.details);
      if (Object.keys(kept).length) body.details = kept;
      if (dropped.length) notes.push(`details dropped: ${dropped.join(', ')}`);
    }
    const cause = exception.cause;
    if (cause !== undefined) notes.unshift(`cause: ${errorMessage(cause)}`);
    let log: LogEntry | undefined;
    if (status >= 500) {
      log = {
        level: 'error',
        text: [exception.code, ...notes].join('; '),
        stack: cause instanceof Error ? errorStack(cause) : undefined,
      };
    } else if (notes.length) {
      log = { level: 'warn', text: [exception.code, ...notes].join('; ') };
    }
    return { body, log };
  }

  const parserCode = bodyParserCode(exception);
  if (parserCode) {
    return {
      body: {
        code: parserCode,
        message: ERROR_CODES[parserCode].message,
        status: ERROR_CODES[parserCode].status,
      },
    };
  }

  if (exception instanceof HttpException) {
    // Framework exceptions (unknown route, pipes, multer): the status stays, the text does not
    const status = exception.getStatus();
    const own = (exception.getResponse() as { code?: unknown } | null)?.code;
    const code = isErrorCode(own) ? own : codeForStatus(status);
    return {
      body: { code, message: ERROR_CODES[code].message, status },
      log:
        status >= 500
          ? {
              level: 'error',
              text: `${code}: ${exception.message}`,
              stack: exception.stack,
            }
          : undefined,
    };
  }

  return {
    body: {
      code: 'internal_error',
      message: ERROR_CODES.internal_error.message,
      status: 500,
    },
    log: {
      level: 'error',
      text: `internal_error: ${errorMessage(exception)}`,
      stack: exception instanceof Error ? errorStack(exception) : undefined,
    },
  };
}

/**
 * Global filter of both APIs: { code, message, status, fields?, retryAfter?, details?, requestId }.
 * Sets Retry-After and Cache-Control: no-store; logs 5xx (with the stack) and causes of handled
 * errors under the request id.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private static readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request | undefined>();
    const res = ctx.getResponse<Response>();
    const requestId = requestIdOf(req, res);
    const { body, log } = describeError(exception);

    if (log) {
      const line = `[${requestId}] ${req?.method ?? ''} ${req?.path ?? ''} ${body.status} ${log.text}`;
      if (log.level === 'error') AppErrorFilter.logger.error(line, log.stack);
      else AppErrorFilter.logger.warn(line);
    }

    if (res.headersSent) return;
    res.setHeader('Cache-Control', 'no-store');
    if (body.retryAfter !== undefined)
      res.setHeader('Retry-After', String(body.retryAfter));
    res.status(body.status).json({ ...body, requestId } satisfies ErrorBody);
  }
}
