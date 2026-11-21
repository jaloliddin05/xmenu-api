import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppException } from 'src/infra/errors/app-exception';
import { PublicRateLimit } from 'src/infra/http/public-rate-limit';
import { Public } from '../auth/decorators/public.decorator';
import { formatViolation, parseCspReports } from './csp-report.parser';

/** Reports per IP: a page with a broken policy sends one per blocked resource, so the cap is per minute. */
export const cspReportRate = () => ({ limit: 60, ttlSeconds: 60 });

/**
 * Receiver of the browsers' Content-Security-Policy reports (report-uri and report-to of the dashboard, the
 * QR menu and the delivery site). Logs one line per violation: directive and hosts, never a path or the visitor.
 */
@ApiTags('Health')
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger('CspReport');

  @Public()
  @PublicRateLimit({ bucket: 'csp', rate: cspReportRate })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'CSP violation report from a browser (legacy report-uri or Reporting API). Up to 16 KB; a broken body is ignored',
  })
  @ApiNoContentResponse()
  report(@Req() req: Request): void {
    // The route parser (csp-report.body.ts) leaves a string; anything else came with another Content-Type
    if (typeof req.body !== 'string')
      throw new AppException('unsupported_media_type');
    for (const violation of parseCspReports(req.body)) {
      this.logger.log(formatViolation(violation));
    }
  }
}
