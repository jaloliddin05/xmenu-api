import {
  hostToUnicode,
  isPlatformHost,
  normalizeHost,
  parseCustomHost,
  platformDomainFrom,
  platformSlug,
} from './host';

const PD = 'xmenu.uz';

describe('normalizeHost', () => {
  it.each([
    ['lower-cases', 'Mant.XMENU.uz', 'mant.xmenu.uz'],
    ['drops the port', 'mant.xmenu.uz:3000', 'mant.xmenu.uz'],
    ['drops port 443', 'restaurant.uz:443', 'restaurant.uz'],
    ['drops the trailing dot', 'restaurant.uz.', 'restaurant.uz'],
    ['trims', '  restaurant.uz ', 'restaurant.uz'],
    ['IDN to punycode', 'Ресторан.UZ', 'xn--80ajzcicfi.uz'],
    ['keeps punycode', 'xn--80ajzcicfi.uz', 'xn--80ajzcicfi.uz'],
    ['single label', 'localhost:3000', 'localhost'],
    ['tunnel host', 'abc-123.trycloudflare.com', 'abc-123.trycloudflare.com'],
  ])('%s', (_why, raw, host) => {
    expect(normalizeHost(raw)).toBe(host);
  });

  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['IPv4', '192.168.0.1'],
    ['IPv4 with port', '127.0.0.1:3000'],
    ['IPv6', '[::1]:3000'],
    ['bad port', 'restaurant.uz:http'],
    ['underscore', 'a_b.uz'],
    ['dash at a label edge', '-a.uz'],
    ['space', 'rest aurant.uz'],
    ['path', 'restaurant.uz/menu'],
    ['scheme', 'https://restaurant.uz'],
    ['empty label', 'a..uz'],
    ['broken punycode', 'xn--zz.uz'],
    ['too long', `${'a'.repeat(63)}.`.repeat(4) + 'uz'],
  ])('refuses %s', (_why, raw) => {
    expect(normalizeHost(raw)).toBeNull();
  });
});

describe('platform hosts', () => {
  it('reads PLATFORM_DOMAIN in canonical form', () => {
    expect(platformDomainFrom({ PLATFORM_DOMAIN: 'XMenu.uz.' })).toBe(PD);
    expect(platformDomainFrom({})).toBeNull();
    expect(platformDomainFrom({ PLATFORM_DOMAIN: ' ' })).toBeNull();
  });

  it('takes exactly one label under the platform domain as the slug', () => {
    expect(platformSlug('mant.xmenu.uz', PD)).toBe('mant');
    expect(platformSlug('api.xmenu.uz', PD)).toBe('api'); // isValidSlug refuses it later
    expect(platformSlug('a.b.xmenu.uz', PD)).toBeNull();
    expect(platformSlug('xmenu.uz', PD)).toBeNull();
    expect(platformSlug('mantxmenu.uz', PD)).toBeNull();
    expect(platformSlug('mant.xmenu.uz', null)).toBeNull();
    expect(platformSlug('cafe.localhost', 'localhost')).toBe('cafe');
  });

  it('treats the platform domain and every host under it as the platform', () => {
    expect(isPlatformHost('xmenu.uz', PD)).toBe(true);
    expect(isPlatformHost('a.b.xmenu.uz', PD)).toBe(true);
    expect(isPlatformHost('notxmenu.uz', PD)).toBe(false);
    expect(isPlatformHost('xmenu.uz', null)).toBe(false);
  });
});

describe('parseCustomHost', () => {
  it.each([
    ['apex domain', 'restaurant.uz', 'restaurant.uz'],
    ['subdomain', 'order.restaurant.uz', 'order.restaurant.uz'],
    [
      'upper case and trailing dot',
      'Order.Restaurant.UZ.',
      'order.restaurant.uz',
    ],
    ['IDN', 'ресторан.uz', 'xn--80ajzcicfi.uz'],
    ['tunnel host', 'abc-123.trycloudflare.com', 'abc-123.trycloudflare.com'],
    ['a look-alike of the platform', 'xmenu.uz.evil.com', 'xmenu.uz.evil.com'],
  ])('accepts %s', (_why, raw, host) => {
    expect(parseCustomHost(raw, PD)).toEqual({ host });
  });

  it.each([
    ['scheme', 'https://restaurant.uz', 'invalid_host'],
    ['path', 'restaurant.uz/menu', 'invalid_host'],
    ['port', 'restaurant.uz:8080', 'invalid_host'],
    ['single label', 'restaurant', 'invalid_host'],
    ['garbage', '***', 'invalid_host'],
    ['not a string', null, 'invalid_host'],
    ['platform domain', 'xmenu.uz', 'platform_host'],
    ['platform subdomain', 'mant.xmenu.uz', 'platform_host'],
    ['reserved platform name', 'API.xmenu.uz', 'platform_host'],
    ['deep platform host', 'a.b.xmenu.uz', 'platform_host'],
    ['IP address', '10.0.0.1', 'reserved_host'],
    ['localhost', 'localhost', 'reserved_host'],
    ['under localhost', 'cafe.localhost', 'reserved_host'],
    ['.local', 'printer.local', 'reserved_host'],
    ['.internal', 'db.internal', 'reserved_host'],
  ])('refuses %s', (_why, raw, problem) => {
    expect(parseCustomHost(raw, PD)).toEqual({ problem });
  });

  it('refuses the dev platform domain tree too', () => {
    expect(parseCustomHost('cafe.localhost', 'localhost')).toEqual({
      problem: 'platform_host',
    });
  });
});

it('shows punycode as Unicode', () => {
  expect(hostToUnicode('xn--80ajzcicfi.uz')).toBe('ресторан.uz');
  expect(hostToUnicode('restaurant.uz')).toBe('restaurant.uz');
});
