import {
  assertTelegramApiConfig,
  telegramApiBaseUrl,
  telegramMethodUrl,
} from './telegram-api-url';

const quiet = { warn: jest.fn() };

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

describe('assertTelegramApiConfig', () => {
  beforeEach(() => quiet.warn.mockClear());

  it('accepts the default everywhere, silently', () => {
    expect(assertTelegramApiConfig({ NODE_ENV: 'production' }, quiet)).toBe(
      'https://api.telegram.org',
    );
    expect(
      assertTelegramApiConfig(
        {
          NODE_ENV: 'production',
          TELEGRAM_API_BASE_URL: 'https://api.telegram.org/',
        },
        quiet,
      ),
    ).toBe('https://api.telegram.org');
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it('refuses any other base in production', () => {
    expect(() =>
      assertTelegramApiConfig(
        { NODE_ENV: 'production', TELEGRAM_API_BASE_URL: 'http://fake:1' },
        quiet,
      ),
    ).toThrow(/NODE_ENV=production/);
  });

  it('allows a fake Telegram outside production, with a warning', () => {
    expect(
      assertTelegramApiConfig(
        { NODE_ENV: 'development', TELEGRAM_API_BASE_URL: 'http://fake:1' },
        quiet,
      ),
    ).toBe('http://fake:1');
    expect(quiet.warn).toHaveBeenCalledTimes(1);
  });

  it.each([['not a url'], ['ftp://fake:1']])('refuses %s', (value) => {
    expect(() =>
      assertTelegramApiConfig({ TELEGRAM_API_BASE_URL: value }, quiet),
    ).toThrow(/TELEGRAM_API_BASE_URL/);
  });
});
