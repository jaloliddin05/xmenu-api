export type CsvCell = string | number | null;

// A spreadsheet runs a cell that starts with one of these as a formula (CSV injection): names of services
// and reasons are typed by people
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 CSV: comma, CRLF, quotes doubled. The UTF-8 BOM makes Excel read Cyrillic and Uzbek letters
 * right.
 */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return (
    '﻿' +
    [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}
