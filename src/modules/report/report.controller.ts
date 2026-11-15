import { Controller, Get, Headers, Query, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  LANGS,
  requireStaffOrganizationId,
  resolveLang,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { couriersCsv, externalCsv, problemsCsv } from './domain/report-csv';
import { parsePeriod, ReportPeriod } from './domain/report-period';
import {
  CourierReportDto,
  ExternalReportDto,
  ProblemReportDto,
  ReportQueryDto,
} from './dto/report.dto';
import { ReportService } from './report.service';

/** Reports of the delivery (owner only: permission reports). Contract: docs/API.md, "Отчёты". */
@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @StaffAccess('reports')
  @Get('couriers')
  @ApiOperation({
    summary:
      'Couriers: deliveries, cash due, received, discrepancy, card, shift hours, accrued pay',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ type: CourierReportDto })
  async couriers(
    @Req() req: StaffRequest,
    @Query() q: ReportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = parsePeriod(q.from, q.to);
    const report = await this.reports.couriers(
      requireStaffOrganizationId(req),
      p,
    );
    return q.format === 'csv'
      ? sendCsv(
          res,
          'couriers',
          p,
          couriersCsv(report, langOf(q, acceptLanguage)),
        )
      : report;
  }

  @StaffAccess('reports')
  @Get('external')
  @ApiOperation({
    summary: 'External services: orders handed over and costs per service',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ type: ExternalReportDto })
  async external(
    @Req() req: StaffRequest,
    @Query() q: ReportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = parsePeriod(q.from, q.to);
    const report = await this.reports.external(
      requireStaffOrganizationId(req),
      p,
    );
    return q.format === 'csv'
      ? sendCsv(
          res,
          'external',
          p,
          externalCsv(report, langOf(q, acceptLanguage)),
        )
      : report;
  }

  @StaffAccess('reports')
  @Get('problems')
  @ApiOperation({
    summary:
      'Problems of delivery orders: no answer, refusals, cannot deliver, returns, cancellations with reasons',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ type: ProblemReportDto })
  async problems(
    @Req() req: StaffRequest,
    @Query() q: ReportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = parsePeriod(q.from, q.to);
    const report = await this.reports.problems(
      requireStaffOrganizationId(req),
      p,
    );
    return q.format === 'csv'
      ? sendCsv(
          res,
          'problems',
          p,
          problemsCsv(report, langOf(q, acceptLanguage)),
        )
      : report;
  }
}

/** The staff dashboard is Russian: ru unless ?lang or Accept-Language asks for uz or en. */
const langOf = (q: ReportQueryDto, acceptLanguage: string | undefined) =>
  resolveLang(
    { query: { lang: q.lang }, headers: { 'accept-language': acceptLanguage } },
    { languages: LANGS, defaultLanguage: 'ru' },
  );

function sendCsv(
  res: Response,
  name: string,
  p: ReportPeriod,
  csv: string,
): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}_${day(p.from)}_${day(p.to)}.csv"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  return csv;
}
