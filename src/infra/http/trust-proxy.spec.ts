import { parseTrustProxy, trustProxyEnvIssues } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '  ', ' , '])(
    'defaults to loopback for %p',
    (raw) => {
      expect(parseTrustProxy(raw)).toEqual(['loopback']);
    },
  );

  it('reads names, addresses and CIDRs, trimmed', () => {
    expect(
      parseTrustProxy(
        ' loopback, uniquelocal ,172.18.0.0/16, 10.0.0.5, fd00::/8, ::1',
      ),
    ).toEqual([
      'loopback',
      'uniquelocal',
      '172.18.0.0/16',
      '10.0.0.5',
      'fd00::/8',
      '::1',
    ]);
  });

  it.each([
    ['trust everyone', 'true'],
    ['a hop count', '1'],
    ['a host name', 'caddy'],
    ['a prefix too long for IPv4', '10.0.0.0/33'],
    ['a prefix too long for IPv6', 'fd00::/129'],
    ['a broken CIDR', '10.0.0.0/8/1'],
    ['one bad entry among good ones', 'loopback,*'],
  ])('refuses %s', (_why, raw) => {
    expect(parseTrustProxy(raw)).toBeNull();
  });
});

describe('trustProxyEnvIssues', () => {
  it('stops the start on an unreadable value, without echoing it', () => {
    const issues = trustProxyEnvIssues({ TRUST_PROXY: 'true' });
    expect(issues.errors).toHaveLength(1);
    expect(issues.errors[0]).toContain('TRUST_PROXY');
    expect(issues.errors[0]).not.toContain('true');
  });

  it('accepts unset and valid values', () => {
    expect(trustProxyEnvIssues({}).errors).toEqual([]);
    expect(trustProxyEnvIssues({ TRUST_PROXY: 'uniquelocal' }).errors).toEqual(
      [],
    );
  });
});
