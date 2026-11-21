import {
  isInternalRequest,
  isPrivateAddress,
  isPublicAddress,
} from './internal-request';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '::1',
    'fd12:3456::1',
    '::ffff:172.18.0.5',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '172.15.255.255',
    '192.169.0.1',
    '2001:db8::1',
    '::ffff:8.8.8.8',
    'not-an-ip',
    '',
    undefined,
  ])('%p is not', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('isInternalRequest', () => {
  const req = (
    remoteAddress?: string,
    headers: Record<string, string> = {},
  ) => ({
    headers,
    socket: { remoteAddress },
  });

  it('a direct call from a container of the private network', () => {
    expect(isInternalRequest(req('172.18.0.3', { host: 'api:4000' }))).toBe(
      true,
    );
  });

  it.each([
    ['forwarded'],
    ['x-forwarded-for'],
    ['x-forwarded-host'],
    ['x-forwarded-proto'],
    ['x-real-ip'],
  ])('not when the request came through a proxy (%s)', (header) => {
    expect(isInternalRequest(req('172.18.0.2', { [header]: '1.2.3.4' }))).toBe(
      false,
    );
  });

  it('not from a public peer, nor without a peer address', () => {
    expect(isInternalRequest(req('203.0.113.7'))).toBe(false);
    expect(isInternalRequest(req(undefined))).toBe(false);
  });
});

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.10',
    '0.0.0.0',
    '0.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '169.254.169.254',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    'not-an-ip',
    '',
    undefined,
  ])('%p is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.32.0.1',
    '2a00:1450:4001::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});
