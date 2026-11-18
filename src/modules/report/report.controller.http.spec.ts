import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { strFromU8, unzipSync } from 'fflate';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const FROM = '2026-11-01T00:00:00+05:00';
const TO = '2026-11-02T00:00:00+05:00';
// The period in UTC: [2026-10-31T19:00Z, 2026-11-01T19:00Z)
const START = new Date('2026-10-31T19:00:00Z');
const END = new Date('2026-11-01T19:00:00Z');

type Range = { gte: Date; lt: Date };
const inRange = (d: Date, r: Range) => d >= r.gte && d < r.lt;

/** Shifts and orders with timestamps on and around the period edges; the where of the service is applied. */
function fakePrisma() {
  const shifts = [
    { id: 'on-from', at: START },
    { id: 'before', at: new Date(START.getTime() - 1) },
    { id: 'last-ms', at: new Date(END.getTime() - 1) },
    { id: 'on-to', at: END },
  ].map((s) => ({
    id: s.id,
    organization_id: ORG,
    courier_id: 'c1',
    courier: { name: '=Bekzod' },
    status: 'awaiting_reconciliation',
    started_at: s.at,
    ended_at: new Date(s.at.getTime() + 3_600_000),
    cash_due: null,
    cash_received: null,
    cash_discrepancy: null,
  }));
  const handed = [START, END].map((at, i) => ({
    external_service: `Taxi ${i}`,
    external_cost: 10_000,
    external_handed_at: at,
    payment_method: 'cash',
    external_cash_received: null,
    total: 50_000,
  }));
  return {
    // No iiko: the courier report is open (OwnCouriersGuard)
    pos_integration: { findUnique: jest.fn(async () => null) },
    courier_shift: {
      findMany: jest.fn(async ({ where }) =>
        shifts.filter(
          (s) =>
            s.organization_id === where.organization_id &&
            inRange(s.started_at, where.started_at),
        ),
      ),
    },
    customer_order: {
      findMany: jest.fn(async ({ where }) =>
        where.status === 'handed_to_external'
          ? handed.filter((o) =>
              inRange(o.external_handed_at, where.external_handed_at),
            )
          : (where.courier_shift_id?.in ?? []).map((id: string) => ({
              courier_shift_id: id,
              status: 'completed',
              payment_method: 'cash',
              cash_collected: 'cash',
              total: 10_000,
              courier_pay: 1_000,
            })),
      ),
    },
    order_status_event: { findMany: jest.fn(async () => []) },
  };
}

describe('GET /reports/*', () => {
  let app: INestApplication;
  const owner = `Bearer ${staffToken('owner')}`;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    app = await createHttpApp(
      {
        controllers: [ReportController],
        providers: [
          ReportService,
          { provide: PrismaService, useValue: fakePrisma() },
        ],
      },
      [{ id: 'owner', role: 'owner', organization: { id: ORG } }],
    );
  });
  afterAll(() => app.close());

  it('a shift on from is in, one on to is out (half-open period); the response repeats the period', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/couriers')
      .query({ from: FROM, to: TO })
      .set('Authorization', owner)
      .expect(200);
    expect(res.body).toMatchObject({
      from: START.toISOString(),
      to: END.toISOString(),
      total: { shifts: 2, deliveries: 2, cashDue: 20_000, pay: 2_000 },
    });
  });

  it('external services on the edges the same way', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/external')
      .query({ from: FROM, to: TO })
      .set('Authorization', owner)
      .expect(200);
    expect(res.body.rows.map((r: { service: string }) => r.service)).toEqual([
      'Taxi 0',
    ]);
  });

  it('CSV: a file with BOM, the request language, a defused formula', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/couriers')
      .query({ from: FROM, to: TO, format: 'csv' })
      .set('Authorization', owner)
      .set('Accept-Language', 'en-US,en;q=0.9')
      .expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="couriers_2026-10-31_2026-11-01.csv"',
    );
    const lines = res.text.split('\r\n');
    expect(lines[0].startsWith('﻿Courier,')).toBe(true);
    expect(lines[1].startsWith("'=Bekzod,2,")).toBe(true);
  });

  it('XLSX: an Excel workbook named after the period, the header in the request language', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/couriers')
      .query({ from: FROM, to: TO, format: 'xlsx', lang: 'uz' })
      .set('Authorization', owner)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="couriers_2026-10-31_2026-11-01.xlsx"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const sheet = strFromU8(
      unzipSync(new Uint8Array(res.body as Buffer))['xl/worksheets/sheet1.xml'],
    );
    expect(sheet).toContain('Davr boshi');
    expect(sheet).toContain('Kuryer');
    // the courier name typed as a formula stays text with the leading quote
    expect(sheet).toContain("'=Bekzod");
    expect(sheet).not.toContain('<f>');
  });

  it.each([
    [{ from: FROM }, 'to'],
    [{ from: TO, to: FROM }, 'to'],
    [{ from: 'yesterday', to: TO }, 'from'],
    [{ from: FROM, to: TO, format: 'pdf' }, 'format'],
  ])('%j → 400 validation_error on %s', async (query, field) => {
    const res = await request(app.getHttpServer())
      .get('/reports/problems')
      .query(query)
      .set('Authorization', owner)
      .expect(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.fields.map((f: { field: string }) => f.field)).toContain(
      field,
    );
  });
});
