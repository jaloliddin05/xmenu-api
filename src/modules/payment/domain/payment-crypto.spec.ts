import { randomBytes } from 'crypto';
import { decryptConfig, encryptConfig, parsePaymentConfigKey } from './payment-crypto';

const key = randomBytes(32);

describe('payment config crypto', () => {
  it('round-trips', () => {
    const cfg = { merchantId: '123', secretKey: 'sec-ret' };
    expect(decryptConfig(encryptConfig(cfg, key), key)).toEqual(cfg);
  });

  it('never stores the secret in clear text and uses a fresh IV each time', () => {
    const a = encryptConfig({ secretKey: 'sec-ret' }, key);
    const b = encryptConfig({ secretKey: 'sec-ret' }, key);
    expect(a).not.toContain('sec-ret');
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext', () => {
    const parts = encryptConfig({ a: 1 }, key).split(':');
    const raw = Buffer.from(parts[3], 'base64');
    raw[0] ^= 1;
    parts[3] = raw.toString('base64');
    expect(() => decryptConfig(parts.join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptConfig(encryptConfig({ a: 1 }, key), randomBytes(32))).toThrow();
  });

  it('accepts hex and base64 keys, refuses missing or short ones', () => {
    const k = randomBytes(32);
    expect(parsePaymentConfigKey(k.toString('hex'))).toEqual(k);
    expect(parsePaymentConfigKey(k.toString('base64'))).toEqual(k);
    expect(() => parsePaymentConfigKey(undefined)).toThrow();
    expect(() => parsePaymentConfigKey('short')).toThrow();
  });
});

import { clickAuthHeader } from '../services/click-api';
describe('clickAuthHeader', () => {
  it('is merchant_user_id:sha1(timestamp+secret):timestamp', () => {
    const h = clickAuthHeader({ merchantUserId: '77', secretKey: 'sec' }, 1700000000);
    const [user, digest, ts] = h.split(':');
    expect(user).toBe('77');
    expect(ts).toBe('1700000000');
    expect(digest).toBe(require('crypto').createHash('sha1').update('1700000000sec').digest('hex'));
  });
});
