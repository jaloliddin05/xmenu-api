import { text } from 'express';

export const CSP_REPORT_PATH = '/csp-report';
export const CSP_REPORT_TYPES = [
  'application/csp-report',
  'application/reports+json',
  'application/json',
];
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/**
 * Raw text parser for POST /csp-report, mounted before the global JSON parser (which then skips the request):
 * the controller parses the JSON itself, so a broken report is dropped quietly instead of 400 invalid_body,
 * and a body over 16 KB is 413 payload_too_large.
 */
export const cspReportBodyParser = text({
  type: CSP_REPORT_TYPES,
  limit: CSP_REPORT_MAX_BYTES,
});
