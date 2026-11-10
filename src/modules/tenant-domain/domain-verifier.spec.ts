import {
  domainConfigFrom,
  domainEnvIssues,
  parseDnsServers,
} from './domain-config';
import { FakeDnsServer } from './dns-server.fake';
import {
  DnsTxtVerifier,
  SkipDomainVerifier,
  TxtResolver,
  txtResolver,
  verifyRecordName,
  verifyRecordValue,
} from './domain-verifier';
import { createDomainVerifier } from './tenant-domain.module';

const resolver = (
  answer: string[][] | Error,
): TxtResolver & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    resolveTxt: async (name) => {
      asked.push(name);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
};
const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe('DnsTxtVerifier', () => {
  it('reads _xmenu-verify.<host> and accepts the exact token', async () => {
    const r = resolver([['other'], ['xmenu-verify=tok-1']]);
    await expect(
      new DnsTxtVerifier(r).check('restaurant.uz', 'tok-1'),
    ).resolves.toEqual({ ok: true });
    expect(r.asked).toEqual(['_xmenu-verify.restaurant.uz']);
    expect(verifyRecordName('a.uz')).toBe('_xmenu-verify.a.uz');
  });

  it('joins a value split into chunks', async () => {
    const r = resolver([['xmenu-verify=', 'tok-1']]);
    await expect(
      new DnsTxtVerifier(r).check('restaurant.uz', 'tok-1'),
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    ['another token', [['xmenu-verify=tok-2']], 'token_mismatch'],
    ['the bare token without the prefix', [['tok-1']], 'token_mismatch'],
    ['no records', [], 'record_not_found'],
    ['no such name', dnsError('ENOTFOUND'), 'record_not_found'],
    ['no TXT data', dnsError('ENODATA'), 'record_not_found'],
    ['a timeout', dnsError('ETIMEOUT'), 'dns_error'],
    ['a server failure', dnsError('ESERVFAIL'), 'dns_error'],
  ])('refuses %s', async (_why, answer, reason) => {
    await expect(
      new DnsTxtVerifier(resolver(answer)).check('restaurant.uz', 'tok-1'),
    ).resolves.toEqual({ ok: false, reason });
  });

  it('is not instant; the skip verifier is', async () => {
    expect(new DnsTxtVerifier(resolver([])).verifiesOnAdd).toBe(false);
    const skip = new SkipDomainVerifier();
    expect(skip.verifiesOnAdd).toBe(true);
    await expect(skip.check()).resolves.toEqual({ ok: true });
  });
});

describe('domainEnvIssues', () => {
  it('refuses DOMAIN_VERIFY_SKIP in production', () => {
    expect(
      domainEnvIssues({
        NODE_ENV: 'production',
        DOMAIN_VERIFY_SKIP: 'true',
        PLATFORM_DOMAIN: 'xmenu.uz',
      }).errors,
    ).toEqual([expect.stringContaining('DOMAIN_VERIFY_SKIP')]);
  });

  it('refuses production without a usable platform domain', () => {
    expect(domainEnvIssues({ NODE_ENV: 'production' }).errors).toEqual([
      expect.stringContaining('PLATFORM_DOMAIN'),
    ]);
    expect(
      domainEnvIssues({
        NODE_ENV: 'production',
        PLATFORM_DOMAIN: 'https://xmenu.uz',
      }).errors,
    ).toEqual([expect.stringContaining('PLATFORM_DOMAIN')]);
  });

  it('has no issues in production with DNS checks and a platform domain', () => {
    expect(
      domainEnvIssues({ NODE_ENV: 'production', PLATFORM_DOMAIN: 'XMenu.uz' }),
    ).toEqual({ errors: [], warnings: [] });
    expect(domainConfigFrom({ PLATFORM_DOMAIN: 'XMenu.uz' })).toEqual({
      platformDomain: 'xmenu.uz',
      skipVerification: false,
      dnsServers: [],
    });
  });

  it('only warns in development', () => {
    const issues = domainEnvIssues({
      NODE_ENV: 'development',
      DOMAIN_VERIFY_SKIP: 'true',
    });
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toHaveLength(2);
  });

  it('takes only the exact value true as the flag', () => {
    expect(
      domainConfigFrom({
        DOMAIN_VERIFY_SKIP: '1',
        PLATFORM_DOMAIN: 'localhost',
      }).skipVerification,
    ).toBe(false);
  });
});

describe('DOMAIN_VERIFY_DNS_SERVERS', () => {
  it.each<[string | undefined, string[] | null]>([
    [undefined, []],
    ['', []],
    ['  ', []],
    ['127.0.0.1', ['127.0.0.1']],
    ['127.0.0.1:5353', ['127.0.0.1:5353']],
    [' 10.0.0.2:53 , 8.8.8.8 ', ['10.0.0.2:53', '8.8.8.8']],
    ['::1', ['::1']],
    ['[::1]:5353', ['[::1]:5353']],
    ['localhost', null],
    ['dns.example:53', null],
    ['127.0.0.1:0', null],
    ['127.0.0.1:70000', null],
    ['127.0.0.1:53,nope', null],
    ['[::1]', null],
  ])('%j -> %j', (raw, expected) => {
    expect(parseDnsServers(raw)).toEqual(expected);
  });

  it('an unreadable list stops the start, in development too', () => {
    for (const NODE_ENV of ['development', 'production'])
      expect(
        domainEnvIssues({
          NODE_ENV,
          PLATFORM_DOMAIN: 'xmenu.uz',
          DOMAIN_VERIFY_DNS_SERVERS: 'localhost:53',
        }).errors,
      ).toEqual([expect.stringContaining('DOMAIN_VERIFY_DNS_SERVERS')]);
  });

  it('allowed in production with a warning; silent in development', () => {
    const env = {
      PLATFORM_DOMAIN: 'xmenu.uz',
      DOMAIN_VERIFY_DNS_SERVERS: '10.0.0.2',
    };
    const prod = domainEnvIssues({ ...env, NODE_ENV: 'production' });
    expect(prod.errors).toEqual([]);
    expect(prod.warnings).toEqual([expect.stringContaining('10.0.0.2')]);
    expect(
      domainEnvIssues({ ...env, NODE_ENV: 'development' }).warnings,
    ).toEqual([]);
  });

  it('domainConfigFrom gives the servers, [] when unset', () => {
    expect(
      domainConfigFrom({ DOMAIN_VERIFY_DNS_SERVERS: '127.0.0.1:5353' })
        .dnsServers,
    ).toEqual(['127.0.0.1:5353']);
    expect(domainConfigFrom({}).dnsServers).toEqual([]);
  });

  describe('against a DNS server on a custom port', () => {
    const dns = new FakeDnsServer();
    let server: string;
    beforeAll(async () => {
      server = await dns.start();
    });
    afterAll(() => dns.stop());

    it('txtResolver asks the given server', async () => {
      dns.records.set('_xmenu-verify.cafe.example', ['xmenu-verify=t1']);
      expect(
        await txtResolver([server]).resolveTxt('_xmenu-verify.cafe.example'),
      ).toEqual([['xmenu-verify=t1']]);
    });

    it('the module factory uses DOMAIN_VERIFY_DNS_SERVERS: verified, mismatch, not found', async () => {
      const verifier = createDomainVerifier({
        NODE_ENV: 'development',
        DOMAIN_VERIFY_DNS_SERVERS: server,
      });
      expect(verifier).toBeInstanceOf(DnsTxtVerifier);
      dns.records.set(verifyRecordName('order.cafe.uz'), [
        verifyRecordValue('tok-1'),
      ]);
      expect(await verifier.check('order.cafe.uz', 'tok-1')).toEqual({
        ok: true,
      });
      expect(await verifier.check('order.cafe.uz', 'other')).toEqual({
        ok: false,
        reason: 'token_mismatch',
      });
      expect(await verifier.check('nothing.cafe.uz', 'tok-1')).toEqual({
        ok: false,
        reason: 'record_not_found',
      });
      expect(dns.asked).toContain('_xmenu-verify.order.cafe.uz');
    });
  });
});
