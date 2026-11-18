import { createHash } from 'crypto';
import { hashWebhookSecret, webhookSecretMatches } from './webhook-secret';

const SECRET = 'a'.repeat(64);

describe('webhook secret hash', () => {
  it('stores sha256 hex, never the secret itself', () => {
    const hash = hashWebhookSecret(SECRET);
    expect(hash).toBe(createHash('sha256').update(SECRET).digest('hex'));
    expect(hash).not.toContain(SECRET);
  });

  it('accepts the header that hashes to the stored value', () => {
    expect(webhookSecretMatches(SECRET, hashWebhookSecret(SECRET))).toBe(true);
  });

  it.each([
    ['another secret', 'b'.repeat(64)],
    ['the stored hash sent back as the header', hashWebhookSecret(SECRET)],
    ['an empty header', ''],
    ['no header', undefined],
  ])('refuses %s', (_why, header) => {
    expect(webhookSecretMatches(header, hashWebhookSecret(SECRET))).toBe(false);
  });

  it('refuses everything when the stored value is not a sha256 hash', () => {
    expect(webhookSecretMatches(SECRET, SECRET)).toBe(false);
    expect(webhookSecretMatches(SECRET, '')).toBe(false);
  });
});
