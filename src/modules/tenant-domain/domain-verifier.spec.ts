import { assertDomainConfig } from './domain-config';
import {
  DnsTxtVerifier,
  SkipDomainVerifier,
  TxtResolver,
  verifyRecordName,
} from './domain-verifier';

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

describe('assertDomainConfig', () => {
  const logger = () => ({ warn: jest.fn() });

  it('refuses DOMAIN_VERIFY_SKIP in production', () => {
    expect(() =>
      assertDomainConfig(
        {
          NODE_ENV: 'production',
          DOMAIN_VERIFY_SKIP: 'true',
          PLATFORM_DOMAIN: 'xmenu.uz',
        },
        logger(),
      ),
    ).toThrow('DOMAIN_VERIFY_SKIP');
  });

  it('refuses production without a usable platform domain', () => {
    expect(() =>
      assertDomainConfig({ NODE_ENV: 'production' }, logger()),
    ).toThrow('PLATFORM_DOMAIN');
    expect(() =>
      assertDomainConfig(
        { NODE_ENV: 'production', PLATFORM_DOMAIN: 'https://xmenu.uz' },
        logger(),
      ),
    ).toThrow('PLATFORM_DOMAIN');
  });

  it('starts in production with DNS checks and a platform domain', () => {
    const log = logger();
    expect(
      assertDomainConfig(
        { NODE_ENV: 'production', PLATFORM_DOMAIN: 'XMenu.uz' },
        log,
      ),
    ).toEqual({ platformDomain: 'xmenu.uz', skipVerification: false });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('only warns in development', () => {
    const log = logger();
    expect(
      assertDomainConfig(
        { NODE_ENV: 'development', DOMAIN_VERIFY_SKIP: 'true' },
        log,
      ),
    ).toEqual({ platformDomain: null, skipVerification: true });
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('takes only the exact value true as the flag', () => {
    expect(
      assertDomainConfig(
        { DOMAIN_VERIFY_SKIP: '1', PLATFORM_DOMAIN: 'localhost' },
        logger(),
      ).skipVerification,
    ).toBe(false);
  });
});
