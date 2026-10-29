import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { CustomerAuthException, CustomerErrorCode } from './customer-auth.exception';

/**
 * Faqat mijoz endpointlarida ishlaydi (controller darajasida ulangan).
 * Global ErrorFilter (xodimlar uchun) formatiga tegmaydi.
 * Format: { error: { code, message, retryAfter?, details? } }
 */
@Catch()
export class CustomerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('CustomerApi');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let code: CustomerErrorCode = 'internal_error';
    let message = 'Internal server error';
    let retryAfter: number | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof CustomerAuthException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message === exception.code ? exception.code : exception.message;
      retryAfter = exception.retryAfter;
      details = exception.details;
    } else if (exception instanceof BadRequestException) {
      status = 400;
      code = 'validation_error';
      const r: any = exception.getResponse();
      message = Array.isArray(r?.message) ? r.message.join('; ') : (r?.message ?? 'Validation failed');
      // Same per-field list as the owner API ({ field, reason, message }), see createValidationPipe
      const errors: unknown = (r as { errors?: unknown } | undefined)?.errors;
      if (Array.isArray(errors)) details = { errors };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r: any = exception.getResponse();
      message = typeof r === 'string' ? r : (r?.message ?? exception.message);
      code = status === 401 ? 'invalid_token' : status === 429 ? 'rate_limited' : 'validation_error';
    } else {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.setHeader('Cache-Control', 'no-store');
    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));

    const error: Record<string, unknown> = { code, message };
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
    if (details !== undefined) error.details = details;
    res.status(status).json({ error });
  }
}
