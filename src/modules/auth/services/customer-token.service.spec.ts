import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import {
  CustomerTokenService,
  ISSUER,
  AUD_CUSTOMER,
  AUD_REGISTRATION,
} from './customer-token.service';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';

const TENANT_A = 'a1111111-1111-1111-1111-111111111111';
const TENANT_B = 'b2222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = 'c3333333-3333-3333-3333-333333333333';
const SESSION_ID = 'd4444444-4444-4444-4444-444444444444';

interface AccessClaims {
  sub: string;
  tid: string;
  sid: string;
  iat: number;
  exp: number;
}

function makeConfig(
  overrides: Partial<CustomerAuthConfig> = {},
): CustomerAuthConfig {
  return {
    accessSecret: 'access-secret-for-tests-only-not-real-32chars',
    registrationSecret: 'registration-secret-for-tests-only-32chars',
    otpHmacSecret: 'unused-in-these-tests',
    otpLength: 4,
    otpTtlSeconds: 300,
    otpMaxAttempts: 5,
    otpCooldownSeconds: 60,
    otpDevMode: false,
    accessTtlSeconds: 900,
    registrationTtlSeconds: 600,
    refreshTtlDays: 30,
    sessionAbsoluteDays: 180,
    refreshReuseLeewaySeconds: 10,
    maxActiveFamilies: 10,
    smsLocale: 'uz',
    telegramInitDataMaxAgeSeconds: 86400,
    ...overrides,
  };
}

describe('CustomerTokenService', () => {
  describe('signAccess', () => {
    it('produces a token carrying sub/tid/sid and the right iss/aud, verifiable with the configured secret', () => {
      const cfg = makeConfig();
      const service = new CustomerTokenService(cfg);
      const verifier = new JwtService();

      const token = service.signAccess(CUSTOMER_ID, TENANT_A, SESSION_ID);
      const payload = verifier.verify<AccessClaims>(token, {
        secret: cfg.accessSecret,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUD_CUSTOMER,
      });

      expect(payload.sub).toBe(CUSTOMER_ID);
      expect(payload.tid).toBe(TENANT_A);
      expect(payload.sid).toBe(SESSION_ID);
      // exp must land within a few seconds of iat + accessTtlSeconds
      expect(payload.exp - payload.iat).toBe(cfg.accessTtlSeconds);
    });

    it('is rejected by a verifier expecting the registration audience', () => {
      const cfg = makeConfig();
      const service = new CustomerTokenService(cfg);
      const verifier = new JwtService();
      const token = service.signAccess(CUSTOMER_ID, TENANT_A, SESSION_ID);

      expect(() => {
        verifier.verify(token, {
          secret: cfg.accessSecret,
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUD_REGISTRATION,
        });
      }).toThrow();
    });

    it('is rejected by a verifier using the registration secret instead of the access secret', () => {
      const cfg = makeConfig();
      const service = new CustomerTokenService(cfg);
      const verifier = new JwtService();
      const token = service.signAccess(CUSTOMER_ID, TENANT_A, SESSION_ID);

      expect(() => {
        verifier.verify(token, {
          secret: cfg.registrationSecret,
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUD_CUSTOMER,
        });
      }).toThrow();
    });
  });

  describe('signRegistration / verifyRegistration round trip', () => {
    it('round-trips phone/tenant through sign -> verify', () => {
      const service = new CustomerTokenService(makeConfig());
      const token = service.signRegistration('+998901234567', TENANT_A);

      const claims = service.verifyRegistration(token, TENANT_A);

      expect(claims.phone).toBe('+998901234567');
      expect(claims.tid).toBe(TENANT_A);
      expect(typeof claims.jti).toBe('string');
      expect(claims.jti.length).toBeGreaterThan(0);
    });

    it('gives each registration token a distinct jti (one-time-use identifier)', () => {
      const service = new CustomerTokenService(makeConfig());
      const tokenA = service.signRegistration('+998901234567', TENANT_A);
      const tokenB = service.signRegistration('+998901234567', TENANT_A);

      const claimsA = service.verifyRegistration(tokenA, TENANT_A);
      const claimsB = service.verifyRegistration(tokenB, TENANT_A);

      expect(claimsA.jti).not.toBe(claimsB.jti);
    });

    it('rejects a token presented against a different tenant than it was issued for', () => {
      const service = new CustomerTokenService(makeConfig());
      const token = service.signRegistration('+998901234567', TENANT_A);

      expect(() => service.verifyRegistration(token, TENANT_B)).toThrow(
        CustomerAuthException,
      );
      try {
        service.verifyRegistration(token, TENANT_B);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'invalid_registration_token',
        );
      }
    });

    it('rejects an expired registration token with registration_expired, not invalid_registration_token', () => {
      // A negative TTL puts `exp` in the past the instant the token is
      // signed, so this exercises real jsonwebtoken expiry handling
      // without sleeping in the test.
      const service = new CustomerTokenService(
        makeConfig({ registrationTtlSeconds: -1 }),
      );
      const token = service.signRegistration('+998901234567', TENANT_A);

      try {
        service.verifyRegistration(token, TENANT_A);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'registration_expired',
        );
      }
    });

    it('rejects a garbage/tampered token string', () => {
      const service = new CustomerTokenService(makeConfig());

      try {
        service.verifyRegistration('not-a-real-jwt', TENANT_A);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'invalid_registration_token',
        );
      }
    });

    it('rejects a token signed with a different secret (e.g. the access secret)', () => {
      const cfg = makeConfig();
      const service = new CustomerTokenService(cfg);
      // Forge a structurally-identical registration token, but signed with
      // the ACCESS secret instead of the registration secret.
      const forged = jwt.sign(
        { phone: '+998901234567', tid: TENANT_A },
        cfg.accessSecret,
        {
          algorithm: 'HS256',
          issuer: ISSUER,
          audience: AUD_REGISTRATION,
          jwtid: 'forged-jti',
          expiresIn: 600,
        },
      );

      try {
        service.verifyRegistration(forged, TENANT_A);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'invalid_registration_token',
        );
      }
    });

    it('rejects a classic alg:none token, even with the right claims and no signature', () => {
      // The textbook JWT "algorithm confusion" attack: craft a token that
      // declares alg:none and carries a valid-looking payload with an
      // empty signature. A verifier that doesn't pin an algorithm
      // allowlist can be tricked into accepting this. verifyRegistration
      // passes algorithms: ['HS256'] explicitly, so this must fail.
      const none = jwt.sign(
        { phone: '+998901234567', tid: TENANT_A, jti: 'x' },
        '',
        {
          algorithm: 'none',
          issuer: ISSUER,
          audience: AUD_REGISTRATION,
          expiresIn: 600,
        },
      );
      const service = new CustomerTokenService(makeConfig());

      try {
        service.verifyRegistration(none, TENANT_A);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'invalid_registration_token',
        );
      }
    });

    it('rejects a registration token missing required claims (e.g. no phone)', () => {
      const cfg = makeConfig();
      const service = new CustomerTokenService(cfg);
      const incomplete = jwt.sign({ tid: TENANT_A }, cfg.registrationSecret, {
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUD_REGISTRATION,
        jwtid: 'some-jti',
        expiresIn: 600,
      });

      try {
        service.verifyRegistration(incomplete, TENANT_A);
        fail('expected verifyRegistration to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomerAuthException);
        expect((err as CustomerAuthException).code).toBe(
          'invalid_registration_token',
        );
      }
    });
  });
});
