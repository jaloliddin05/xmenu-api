import { maskIp, parseUserAgent } from './user-agent';

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      { device: 'desktop', browser: 'Chrome', os: 'Windows' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
      { device: 'desktop', browser: 'Edge', os: 'Windows' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      { device: 'mobile', browser: 'Safari', os: 'iOS' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      { device: 'mobile', browser: 'Chrome', os: 'Android' },
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      { device: 'tablet', browser: 'Safari', os: 'iOS' },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
      { device: 'desktop', browser: 'Firefox', os: 'macOS' },
    ],
  ])('%s', (ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });

  it('an empty or unknown agent gives unknown, not a crash', () => {
    expect(parseUserAgent(null)).toEqual({
      device: 'unknown',
      browser: null,
      os: null,
    });
    expect(parseUserAgent('curl/8.0')).toEqual({
      device: 'unknown',
      browser: null,
      os: null,
    });
  });
});

describe('maskIp', () => {
  it.each([
    ['203.0.113.7', '203.0.*.*'],
    ['::ffff:203.0.113.7', '203.0.*.*'],
    ['2001:db8:85a3::8a2e:370:7334', '2001:db8:*'],
    ['::1', '1:*'],
    ['', null],
    [null, null],
    ['not an ip', null],
  ])('%s', (ip, expected) => {
    expect(maskIp(ip)).toBe(expected);
  });
});
