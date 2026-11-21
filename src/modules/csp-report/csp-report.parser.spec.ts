import {
  formatViolation,
  MAX_VIOLATIONS_PER_REQUEST,
  originPart,
  parseCspReports,
} from './csp-report.parser';

const legacy = (report: object) => JSON.stringify({ 'csp-report': report });

describe('parseCspReports', () => {
  it('reads the legacy report-uri body: directive and hosts, no path or query', () => {
    const raw = legacy({
      'document-uri': 'https://mant.xmenu.uz/ru/cart?step=2#x',
      'blocked-uri': 'https://evil.example.com:8443/x.js?token=secret',
      'effective-directive': 'script-src-elem',
      'violated-directive': 'script-src-elem',
      'original-policy': "default-src 'self'",
    });
    expect(parseCspReports(raw)).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'evil.example.com:8443',
        document: 'mant.xmenu.uz',
      },
    ]);
  });

  it('falls back to violated-directive and keeps only its name', () => {
    const raw = legacy({
      'document-uri': 'https://dashboard.xmenu.uz/',
      'blocked-uri': 'inline',
      'violated-directive': "style-src 'self'",
    });
    expect(parseCspReports(raw)[0]).toEqual({
      directive: 'style-src',
      blocked: 'inline',
      document: 'dashboard.xmenu.uz',
    });
  });

  it('reads Reporting API batches and skips other report types', () => {
    const raw = JSON.stringify([
      {
        type: 'csp-violation',
        url: 'https://qr.xmenu.uz/ru/mant',
        body: {
          documentURL: 'https://qr.xmenu.uz/ru/mant?utm=1',
          blockedURL: 'https://www.google-analytics.com/g/collect?v=2&cid=1',
          effectiveDirective: 'connect-src',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
      { type: 'csp-violation', body: null },
    ]);
    expect(parseCspReports(raw)).toEqual([
      {
        directive: 'connect-src',
        blocked: 'www.google-analytics.com',
        document: 'qr.xmenu.uz',
      },
    ]);
  });

  it('keeps keywords and schemes, never extension paths', () => {
    expect(originPart('eval')).toBe('eval');
    expect(originPart('data')).toBe('data');
    expect(originPart('data:image/png;base64,AAAA')).toBe('data');
    expect(originPart('blob:https://mant.xmenu.uz/uuid')).toBe('blob');
    expect(originPart('chrome-extension://abcdef/content.js')).toBe(
      'chrome-extension',
    );
    expect(originPart('wss://api.xmenu.uz/socket')).toBe('api.xmenu.uz');
    expect(originPart('not a url')).toBe('unknown');
    expect(originPart(42)).toBe('unknown');
    expect(originPart('')).toBe('unknown');
  });

  it('broken JSON or an unknown shape gives nothing', () => {
    expect(parseCspReports('{"csp-report":')).toEqual([]);
    expect(parseCspReports('')).toEqual([]);
    expect(parseCspReports('"text"')).toEqual([]);
    expect(parseCspReports('{"foo":1}')).toEqual([]);
    expect(parseCspReports('{"csp-report":"x"}')).toEqual([]);
  });

  it('caps a batch and strips control characters from the directive', () => {
    const entry = {
      type: 'csp-violation',
      body: {
        documentURL: 'https://a.xmenu.uz/',
        blockedURL: 'eval',
        effectiveDirective: 'script-src\u0000\u001b[31m',
      },
    };
    const many = parseCspReports(JSON.stringify(Array(25).fill(entry)));
    expect(many).toHaveLength(MAX_VIOLATIONS_PER_REQUEST);
    expect(many[0].directive).toBe('script-src[31m');
  });

  it('formats one log line', () => {
    expect(
      formatViolation({
        directive: 'img-src',
        blocked: 'core-renderer-tiles.maps.yandex.net',
        document: 'mant.xmenu.uz',
      }),
    ).toBe(
      'csp_report directive=img-src blocked=core-renderer-tiles.maps.yandex.net document=mant.xmenu.uz',
    );
  });
});
