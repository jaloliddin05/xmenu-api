import { IIKO_OFFICIAL_API_HOSTS, iikoApiEnvIssues } from './iiko-api-url';

const prod = (base?: string) => ({
  NODE_ENV: 'production',
  ...(base === undefined ? {} : { IIKO_API_BASE_URL: base }),
});

describe('iikoApiEnvIssues', () => {
  it('production: unset or https on an official iiko host', () => {
    expect(iikoApiEnvIssues(prod()).errors).toEqual([]);
    for (const host of IIKO_OFFICIAL_API_HOSTS)
      expect(iikoApiEnvIssues(prod(`https://${host}/`)).errors).toEqual([]);
  });

  it.each([
    'https://evil.example',
    'http://api-ru.iiko.services',
    'https://api-ru.iiko.services:8443',
    'https://api-ru.iiko.services/proxy',
    'https://user:pass@api-ru.iiko.services',
    'https://api-ru.iiko.services.evil.example',
    'not a url',
  ])('production refuses %s', (base) => {
    expect(iikoApiEnvIssues(prod(base)).errors).toEqual([
      expect.stringMatching(/IIKO_API_BASE_URL.*official iiko host/),
    ]);
  });

  it('elsewhere a fake iiko is a warning, a non-URL an error', () => {
    expect(
      iikoApiEnvIssues({ IIKO_API_BASE_URL: 'http://127.0.0.1:4607' }),
    ).toEqual({
      errors: [],
      warnings: [expect.stringMatching(/not the default/)],
    });
    expect(
      iikoApiEnvIssues({ IIKO_API_BASE_URL: 'ftp://x' }).errors,
    ).not.toEqual([]);
  });
});
