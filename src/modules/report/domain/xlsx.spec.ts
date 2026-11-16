import { strFromU8, unzipSync } from 'fflate';
import { courierReport } from './courier-report';
import { couriersTable, periodLabels, ReportTable } from './report-table';
import { toXlsx, wallClock } from './xlsx';

/** The parts of the workbook as text */
const parts = (file: Buffer) =>
  Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(file))).map(([name, data]) => [
      name,
      strFromU8(data),
    ]),
  );

/** The cells of the sheet: reference → { type, style, value } */
function cells(sheet: string) {
  const out: Record<string, { t?: string; s: number; v: string }> = {};
  for (const m of sheet.matchAll(
    /<c r="([A-Z]+\d+)" s="(\d+)"(?: t="(\w+)")?>(.*?)<\/c>/g,
  )) {
    const [, ref, s, t, body] = m;
    const v =
      /<v>(.*?)<\/v>/.exec(body)?.[1] ??
      /<t[^>]*>(.*?)<\/t>/.exec(body)?.[1] ??
      '';
    out[ref] = { t, s: Number(s), v };
  }
  return out;
}

const TABLE: ReportTable = {
  title: 'Курьеры',
  header: ['Курьер', 'Часы смен', 'К сдаче'],
  rows: [
    ['=HYPERLINK("x")', 7.5, 120000],
    ['Aziz <&>', 2, 0],
    ['Итого', 9.5, 120000],
  ],
  hasTotal: true,
};

describe('XLSX report (W13-03)', () => {
  const file = toXlsx(TABLE, {
    labels: periodLabels('ru'),
    from: wallClock('2026-11-01T00:00:00+05:00'),
    to: wallClock('2026-12-01T00:00:00+05:00'),
  });
  const p = parts(file);
  const sheet = cells(p['xl/worksheets/sheet1.xml']);

  it('is an Office Open XML package with one sheet named after the report', () => {
    expect(Object.keys(p).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(p['xl/workbook.xml']).toContain('<sheet name="Курьеры"');
  });

  it('the period above the table as date cells of the local day', () => {
    expect(sheet.A1).toMatchObject({ t: 'inlineStr', v: 'Период с' });
    expect(sheet.A2.v).toBe('до');
    // 2026-11-01 00:00 and 2026-12-01 00:00 as Excel serials, in the date style
    expect(sheet.B1).toMatchObject({ s: 4, v: '46327' });
    expect(sheet.B2).toMatchObject({ s: 4, v: '46357' });
    expect(sheet.B1.t).toBeUndefined();
  });

  it('the header in the request language, bold; numbers are number cells', () => {
    expect([sheet.A4.v, sheet.B4.v, sheet.C4.v]).toEqual([
      'Курьер',
      'Часы смен',
      'К сдаче',
    ]);
    expect(sheet.A4.s).toBe(1);
    expect(sheet.B5).toMatchObject({ v: '7.5', s: 3 });
    expect(sheet.C5).toMatchObject({ v: '120000', s: 2 });
    expect(sheet.B5.t).toBeUndefined();
    // the total row is bold
    expect([sheet.A7.s, sheet.B7.s, sheet.C7.s]).toEqual([5, 7, 6]);
  });

  it('typed text is defused like in the CSV and never written as a formula; XML is escaped', () => {
    expect(sheet.A5).toMatchObject({
      t: 'inlineStr',
      v: "'=HYPERLINK(&quot;x&quot;)",
    });
    expect(p['xl/worksheets/sheet1.xml']).not.toContain('<f>');
    expect(sheet.A6.v).toBe('Aziz &lt;&amp;&gt;');
  });

  it('the header row stays in view while scrolling', () => {
    expect(p['xl/worksheets/sheet1.xml']).toContain(
      '<pane ySplit="4" topLeftCell="A5"',
    );
  });

  it('control characters typed into a name do not break the file', () => {
    const odd = toXlsx({ ...TABLE, rows: [['Bek\u0007zod', 1, 1]] });
    expect(cells(parts(odd)['xl/worksheets/sheet1.xml']).A2.v).toBe('Bekzod');
  });

  it('the courier report in uz and en', () => {
    const empty = courierReport([], [], new Date());
    for (const [lang, name] of [
      ['uz', 'Kuryer'],
      ['en', 'Courier'],
    ] as const) {
      const sheet = cells(
        parts(toXlsx(couriersTable(empty, lang)))['xl/worksheets/sheet1.xml'],
      );
      expect(sheet.A1.v).toBe(name);
    }
  });
});

describe('wallClock', () => {
  it('keeps the written local time, whatever the offset', () => {
    expect(wallClock('2026-11-01T00:00:00+05:00').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(wallClock('2026-11-01').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});
