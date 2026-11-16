import { strToU8, zipSync } from 'fflate';
import { defuseFormula } from './csv';
import type { ReportCell, ReportTable } from './report-table';

/**
 * A report as an Office Open XML workbook (.xlsx) with one sheet. Excel splits it into columns whatever the
 * list separator of its locale (a CSV is one column in ru and uz Excel), numbers are number cells, the
 * period is two date cells above the table. Written by hand (a few XML parts zipped): no spreadsheet library.
 * Texts typed by people are defused like in the CSV (a leading quote), and written as text, never a formula.
 */

export interface XlsxPeriod {
  labels: { from: string; to: string };
  /** Wall-clock time of the request (wallClock): Excel dates have no time zone */
  from: Date;
  to: Date;
}

// Cell styles (cellXfs below, in this order)
const STYLE = {
  text: 0,
  header: 1,
  int: 2,
  decimal: 3,
  date: 4,
  totalText: 5,
  totalInt: 6,
  totalDecimal: 7,
} as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0#"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Characters XML 1.0 does not allow (control characters typed or pasted into a name)
// eslint-disable-next-line no-control-regex -- these are exactly the characters to drop
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const escapeXml = (text: string) =>
  text
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A1 column letters: 0 → A, 25 → Z, 26 → AA */
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel date serial (1900 system) of a wall-clock time kept in UTC fields */
const excelDate = (d: Date) => d.getTime() / 86_400_000 + 25_569;

/**
 * The wall-clock time written in an ISO 8601 string, kept in the UTC fields of a Date: the period the
 * dashboard sends (local midnight with its offset) shows as that local date in Excel.
 */
export function wallClock(iso: string): Date {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return new Date(iso);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

type Cell = { v: ReportCell | Date; s: number };

function cellXml(ref: string, cell: Cell): string {
  const { v, s } = cell;
  if (v === null || v === '') return '';
  if (v instanceof Date)
    return `<c r="${ref}" s="${s}"><v>${excelDate(v)}</v></c>`;
  if (typeof v === 'number')
    return Number.isFinite(v) ? `<c r="${ref}" s="${s}"><v>${v}</v></c>` : '';
  // Inline text: never a formula; leading and trailing spaces kept
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(defuseFormula(v))}</t></is></c>`;
}

const numberStyle = (v: number, total: boolean) =>
  Number.isInteger(v)
    ? total
      ? STYLE.totalInt
      : STYLE.int
    : total
      ? STYLE.totalDecimal
      : STYLE.decimal;

function sheetXml(table: ReportTable, period?: XlsxPeriod): string {
  const grid: Cell[][] = [];
  if (period) {
    grid.push([
      { v: period.labels.from, s: STYLE.text },
      { v: period.from, s: STYLE.date },
    ]);
    grid.push([
      { v: period.labels.to, s: STYLE.text },
      { v: period.to, s: STYLE.date },
    ]);
    grid.push([]);
  }
  const headerRow = grid.length;
  grid.push(table.header.map((v) => ({ v, s: STYLE.header })));
  table.rows.forEach((row, i) => {
    const total = table.hasTotal && i === table.rows.length - 1;
    grid.push(
      row.map((v) => ({
        v,
        s:
          typeof v === 'number'
            ? numberStyle(v, total)
            : total
              ? STYLE.totalText
              : STYLE.text,
      })),
    );
  });

  // Widths by the longest text of each column (dates and numbers need about 16)
  const columns = Math.max(...grid.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.min(
      60,
      Math.max(
        10,
        ...grid.map((r) => {
          const v = r[c]?.v;
          return v instanceof Date ? 16 : v == null ? 0 : String(v).length + 2;
        }),
      ),
    ),
  );

  const rows = grid
    .map((row, r) => {
      const cells = row
        .map((cell, c) => cellXml(`${columnName(c)}${r + 1}`, cell))
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const frozen = headerRow + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData>
</worksheet>`;
}

/** Excel refuses a sheet name with []:*?/\ or longer than 31 characters */
const sheetName = (title: string) =>
  title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report';

export function toXlsx(table: ReportTable, period?: XlsxPeriod): Buffer {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName(table.title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const zip = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES_XML),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml(table, period)),
    },
    // A fixed time: the same report gives the same bytes
    { level: 6, mtime: new Date('2026-01-01T00:00:00Z') },
  );
  return Buffer.from(zip);
}
