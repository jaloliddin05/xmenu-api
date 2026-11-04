import type { DomainOwnershipVerifier, VerifyResult } from './domain-verifier';

/** Test verifier: answers what `next` says and records what it was asked. */
export class FakeDomainVerifier implements DomainOwnershipVerifier {
  calls: { host: string; token: string }[] = [];
  next: VerifyResult = { ok: false, reason: 'record_not_found' };

  constructor(readonly verifiesOnAdd = false) {}

  async check(host: string, token: string): Promise<VerifyResult> {
    this.calls.push({ host, token });
    return this.next;
  }
}
