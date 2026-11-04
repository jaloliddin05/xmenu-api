import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DnsTxtVerifier,
  DOMAIN_VERIFIER,
  SkipDomainVerifier,
} from './domain-verifier';
import { domainVerifierProvider } from './tenant-domain.module';

/** Resolves DOMAIN_VERIFIER the way the module does, with this environment. */
async function verifierWith(env: Record<string, string>) {
  const saved = { ...process.env };
  delete process.env.DOMAIN_VERIFY_SKIP;
  Object.assign(process.env, env);
  try {
    const moduleRef = await Test.createTestingModule({
      providers: [domainVerifierProvider],
    }).compile();
    return moduleRef.get<unknown>(DOMAIN_VERIFIER);
  } finally {
    process.env = saved;
  }
}

describe('TenantDomainModule verifier factory', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('skips the DNS check with DOMAIN_VERIFY_SKIP=true in development', async () => {
    expect(
      await verifierWith({
        NODE_ENV: 'development',
        PLATFORM_DOMAIN: 'localhost',
        DOMAIN_VERIFY_SKIP: 'true',
      }),
    ).toBeInstanceOf(SkipDomainVerifier);
  });

  it.each([
    ['development without the flag', { NODE_ENV: 'development' }],
    ['the flag set to anything but true', { DOMAIN_VERIFY_SKIP: '1' }],
    ['production without the flag', { NODE_ENV: 'production' }],
  ])('checks DNS TXT in %s', async (_why, env) => {
    const verifier = await verifierWith({
      NODE_ENV: 'development',
      PLATFORM_DOMAIN: 'xmenu.uz',
      ...env,
    });
    expect(verifier).toBeInstanceOf(DnsTxtVerifier);
    expect(verifier).not.toBeInstanceOf(SkipDomainVerifier);
  });

  it('refuses to start in production with DOMAIN_VERIFY_SKIP=true', async () => {
    await expect(
      verifierWith({
        NODE_ENV: 'production',
        PLATFORM_DOMAIN: 'xmenu.uz',
        DOMAIN_VERIFY_SKIP: 'true',
      }),
    ).rejects.toThrow(/DOMAIN_VERIFY_SKIP=true is not allowed/);
  });
});
