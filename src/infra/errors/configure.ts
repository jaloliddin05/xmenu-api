import { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  CSP_REPORT_PATH,
  cspReportBodyParser,
} from 'src/modules/csp-report/csp-report.body';
import { createValidationPipe } from '../validators/validation-errors';
import { AppErrorFilter } from './app-error-filter';
import { AppException } from './app-exception';
import { requestIdMiddleware } from './request-id';

/**
 * Broken JSON from body-parser becomes 400 invalid_body. Nest would turn the parser's SyntaxError into
 * a plain 400 that cannot be told apart from other ones.
 */
function bodyParseErrors(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const type = (err as { type?: unknown } | null)?.type;
  next(type === 'entity.parse.failed' ? new AppException('invalid_body') : err);
}

/**
 * Request ids, body parsers, the error filter and the validation pipe, as main.ts and the HTTP specs
 * wire them. The parsers are the ones Nest would add (same defaults); registered here Nest skips its own.
 * CSP reports get their own raw text parser first (16 KB, broken JSON is not an error there).
 */
export function configureErrorHandling(app: INestApplication): void {
  app.use(requestIdMiddleware);
  app.use(CSP_REPORT_PATH, cspReportBodyParser);
  app.use(json(), urlencoded({ extended: true }), bodyParseErrors);
  app.useGlobalFilters(new AppErrorFilter());
  app.useGlobalPipes(createValidationPipe());
}
