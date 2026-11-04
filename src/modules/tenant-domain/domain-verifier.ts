import { Resolver } from 'node:dns/promises';

/**
 * Proof that the owner controls a host: a TXT record `_xmenu-verify.<host>` with the value
 * `xmenu-verify=<token>`, where the token is the one shown for that venue's domain row.
 */
export const DOMAIN_VERIFIER = Symbol('DOMAIN_VERIFIER');

export type VerifyFailure = 'record_not_found' | 'token_mismatch' | 'dns_error';
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

export interface DomainOwnershipVerifier {
  /** True when every domain counts as verified the moment it is added (development only). */
  readonly verifiesOnAdd: boolean;
  check(host: string, token: string): Promise<VerifyResult>;
}

export const verifyRecordName = (host: string) => `_xmenu-verify.${host}`;
export const verifyRecordValue = (token: string) => `xmenu-verify=${token}`;

export interface TxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA']);

export class DnsTxtVerifier implements DomainOwnershipVerifier {
  readonly verifiesOnAdd = false;

  constructor(
    private readonly resolver: TxtResolver = new Resolver({
      timeout: 3000,
      tries: 2,
    }),
  ) {}

  async check(host: string, token: string): Promise<VerifyResult> {
    let records: string[][];
    try {
      records = await this.resolver.resolveTxt(verifyRecordName(host));
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      return {
        ok: false,
        reason:
          typeof code === 'string' && NOT_FOUND_CODES.has(code)
            ? 'record_not_found'
            : 'dns_error',
      };
    }
    if (!records.length) return { ok: false, reason: 'record_not_found' };
    // A long TXT value arrives split into chunks of up to 255 bytes
    const expected = verifyRecordValue(token);
    return records.some((chunks) => chunks.join('').trim() === expected)
      ? { ok: true }
      : { ok: false, reason: 'token_mismatch' };
  }
}

/** DOMAIN_VERIFY_SKIP=true (development, e.g. a tunnel host): no DNS, every domain is verified. */
export class SkipDomainVerifier implements DomainOwnershipVerifier {
  readonly verifiesOnAdd = true;

  check(): Promise<VerifyResult> {
    return Promise.resolve({ ok: true });
  }
}
