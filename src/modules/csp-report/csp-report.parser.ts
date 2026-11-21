/** One CSP violation as it is logged: no path, no query, nothing about the visitor. */
export interface CspViolation {
  directive: string;
  /** Host of the blocked resource, its scheme (`data`, `chrome-extension`) or a CSP keyword (`inline`, `eval`) */
  blocked: string;
  /** Host of the page that broke the policy */
  document: string;
}

/** A browser sends one report per violation; a batch of the Reporting API is capped here for the log. */
export const MAX_VIOLATIONS_PER_REQUEST = 10;

const MAX_VALUE = 100;
const KEYWORDS = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'self',
  'data',
  'blob',
  'trusted-types-policy',
  'trusted-types-sink',
]);

/** Printable token for the log line: no spaces or control characters, bounded length. */
function clean(value: string): string {
  const token = value.replace(/[^\x21-\x7e]/g, '').slice(0, MAX_VALUE);
  return token || 'unknown';
}

/** Host for network schemes, the scheme for the others; a bare keyword stays as it is. */
export function originPart(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'unknown';
  const raw = value.trim();
  if (KEYWORDS.has(raw.toLowerCase())) return raw.toLowerCase();
  try {
    const url = new URL(raw);
    if (/^(https?|wss?):$/.test(url.protocol)) return clean(url.host);
    return clean(url.protocol.replace(/:$/, ''));
  } catch {
    return 'unknown';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `violated-directive` may carry the whole directive with sources: only its name is kept. */
function directiveName(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  return clean(value.trim().split(/\s+/)[0] ?? '');
}

/** Legacy `report-uri` body: `{ "csp-report": { "effective-directive", "blocked-uri", "document-uri" } }`. */
function fromLegacy(report: Record<string, unknown>): CspViolation {
  return {
    directive: directiveName(
      report['effective-directive'] ?? report['violated-directive'],
    ),
    blocked: originPart(report['blocked-uri']),
    document: originPart(report['document-uri']),
  };
}

/** Reporting API (`report-to`): `[{ type: 'csp-violation', body: { effectiveDirective, blockedURL, documentURL } }]`. */
function fromReportingApi(entries: unknown[]): CspViolation[] {
  return entries
    .filter(
      (e): e is { type: string; body: Record<string, unknown> } =>
        isObject(e) && e.type === 'csp-violation' && isObject(e.body),
    )
    .map(({ body }) => ({
      directive: directiveName(body.effectiveDirective),
      blocked: originPart(body.blockedURL),
      document: originPart(body.documentURL),
    }));
}

/**
 * Violations from a report body of either format, whatever Content-Type it came with. Broken JSON or an
 * unknown shape gives an empty list: reports are best effort and a bad one is not worth a log line.
 */
export function parseCspReports(raw: string): CspViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const violations = Array.isArray(data)
    ? fromReportingApi(data)
    : isObject(data) && isObject(data['csp-report'])
      ? [fromLegacy(data['csp-report'])]
      : [];
  return violations.slice(0, MAX_VIOLATIONS_PER_REQUEST);
}

export const formatViolation = (v: CspViolation): string =>
  `csp_report directive=${v.directive} blocked=${v.blocked} document=${v.document}`;
