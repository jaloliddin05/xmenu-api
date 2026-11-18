import { isInternalRequest, isPrivateAddress } from './internal-request';

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
