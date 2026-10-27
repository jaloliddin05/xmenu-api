import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
class ErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    console.log(exception);
    console.log(host.getArgs()[0].route);

    // Machine-readable code and retry hint, when the exception carries them (e.g. owner auth)
    const extra: { code?: string; retryAfter?: number } = {};
    const body = exception.getResponse();
    if (body && typeof body === 'object') {
      const { code, retryAfter } = body as Record<string, unknown>;
      if (typeof code === 'string') extra.code = code;
      if (typeof retryAfter === 'number') {
        extra.retryAfter = retryAfter;
        response.setHeader('Retry-After', String(retryAfter));
      }
    }

    response.status(status).json({
      status,
      timestamp: new Date().toISOString(),
      message: exception.message,
      ...extra,
    });
  }
}

export default ErrorFilter;
