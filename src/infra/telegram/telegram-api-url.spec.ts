import {
  telegramApiBaseUrl,
  telegramApiEnvIssues,
  telegramMethodUrl,
} from './telegram-api-url';

describe('telegramApiBaseUrl', () => {
  it('defaults to the real Telegram', () => {
    expect(telegramApiBaseUrl({})).toBe('https://api.telegram.org');
    expect(telegramApiBaseUrl({ TELEGRAM_API_BASE_URL: '  ' })).toBe(
      'https://api.telegram.org',
    );
  });

  it('takes the configured base without a trailing slash', () => {
    const env = { TELEGRAM_API_BASE_URL: 'http://127.0.0.1:4604/' };
    expect(telegramApiBaseUrl(env)).toBe('http://127.0.0.1:4604');
    expect(telegramMethodUrl('1:T', 'getMe', env)).toBe(
      'http://127.0.0.1:4604/bot1:T/getMe',
    );
  });
});

describe('telegramApiEnvIssues', () => {
  it('accepts the default everywhere, silently', () => {
    expect(telegramApiEnvIssues({ NODE_ENV: 'production' })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(
      telegramApiEnvIssues({
        NODE_ENV: 'production',
        TELEGRAM_API_BASE_URL: 'https://api.telegram.org/',
      }),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('refuses any other base in production', () => {
    expect(
      telegramApiEnvIssues({
        NODE_ENV: 'production',
        TELEGRAM_API_BASE_URL: 'http://fake:1',
      }).errors,
    ).toEqual([expect.stringMatching(/NODE_ENV=production/)]);
  });

  it('allows a fake Telegram outside production, with a warning', () => {
    const issues = telegramApiEnvIssues({
      NODE_ENV: 'development',
      TELEGRAM_API_BASE_URL: 'http://fake:1',
    });
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toHaveLength(1);
  });

  it.each([['not a url'], ['ftp://fake:1']])('refuses %s', (value) => {
    expect(
      telegramApiEnvIssues({ TELEGRAM_API_BASE_URL: value }).errors,
    ).toEqual([expect.stringContaining('TELEGRAM_API_BASE_URL')]);
  });
});
