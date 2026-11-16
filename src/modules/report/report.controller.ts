import {
  Controller,
  Get,
  Headers,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type Lang,
  LANGS,
  requireStaffOrganizationId,
  resolveLang,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { tableCsv } from './domain/csv';
import {
  couriersTable,
  externalTable,
  periodLabels,
  problemsTable,
  ReportTable,
} from './domain/report-table';
import { toXlsx, wallClock, XLSX_CONTENT_TYPE } from './domain/xlsx';
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
  @ApiProduces('application/json', 'text/csv', XLSX_CONTENT_TYPE)
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
    return q.format && q.format !== 'json'
      ? sendFile(
          res,
          'couriers',
          q,
          p,
          (lang) => couriersTable(report, lang),
          acceptLanguage,
        )
      : report;
  }

  @StaffAccess('reports')
  @Get('external')
  @ApiOperation({
    summary: 'External services: orders handed over and costs per service',
  })
  @ApiProduces('application/json', 'text/csv', XLSX_CONTENT_TYPE)
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
    return q.format && q.format !== 'json'
      ? sendFile(
          res,
          'external',
          q,
          p,
          (lang) => externalTable(report, lang),
          acceptLanguage,
        )
      : report;
  }

  @StaffAccess('reports')
  @Get('problems')
  @ApiOperation({
    summary:
      'Problems of delivery orders: no answer, refusals, cannot deliver, returns, cancellations with reasons',
  })
  @ApiProduces('application/json', 'text/csv', XLSX_CONTENT_TYPE)
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
    return q.format && q.format !== 'json'
      ? sendFile(
          res,
          'problems',
          q,
          p,
          (lang) => problemsTable(report, lang),
          acceptLanguage,
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

/**
 * The report as a file in the request language: csv (comma, UTF-8 with BOM) or xlsx (columns, numbers and the
 * period as dates whatever the Excel locale).
 */
function sendFile(
  res: Response,
  name: string,
  q: ReportQueryDto,
  p: ReportPeriod,
  table: (lang: Lang) => ReportTable,
  acceptLanguage: string | undefined,
): string | StreamableFile {
  const lang = langOf(q, acceptLanguage);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const xlsx = q.format === 'xlsx';
  res.setHeader(
    'Content-Type',
    xlsx ? XLSX_CONTENT_TYPE : 'text/csv; charset=utf-8',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}_${day(p.from)}_${day(p.to)}.${xlsx ? 'xlsx' : 'csv'}"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  // A binary body goes as a file: Nest would send a plain Buffer as JSON
  return xlsx
    ? new StreamableFile(
        toXlsx(table(lang), {
          labels: periodLabels(lang),
          from: wallClock(q.from),
          to: wallClock(q.to),
        }),
      )
    : tableCsv(table(lang));
}
