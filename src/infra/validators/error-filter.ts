import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Code for exceptions that do not carry their own. */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'bad_gateway',
  503: 'unavailable',
};

export const defaultErrorCode = (status: number) =>
  CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');

/**
 * Owner API error shape: { status, timestamp, code, message, retryAfter?, errors?, details? }.
 * `code` is always present; `errors` lists failed fields ({ field, reason, message }).
 */
@Catch(HttpException)
class ErrorFilter implements ExceptionFilter {
  private static readonly logger = new Logger('HttpError');

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    // Client errors (401, 404, validation) are expected traffic: no log, no stack trace
    if (status >= 500) ErrorFilter.logger.error(exception.message, exception.stack);

    const extra: Record<string, unknown> = {};
    let code = defaultErrorCode(status);
    let message = exception.message;
    const body = exception.getResponse();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.code === 'string') code = b.code;
      if (typeof b.message === 'string') message = b.message;
      else if (Array.isArray(b.message)) message = b.message.join('; ');
      if (typeof b.retryAfter === 'number') {
        extra.retryAfter = b.retryAfter;
        response.setHeader('Retry-After', String(b.retryAfter));
      }
      if (Array.isArray(b.errors)) extra.errors = b.errors;
      if (b.details && typeof b.details === 'object') extra.details = b.details;
    }

    response.status(status).json({
      status,
      timestamp: new Date().toISOString(),
      code,
      message,
      ...extra,
    });
  }
}

export default ErrorFilter;
