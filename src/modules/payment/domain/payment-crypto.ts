import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Tenant to'lov kalitlari (Click secret_key, Payme key) bazada ochiq matn
 * sifatida saqlanmaydi: AES-256-GCM, kalit PAYMENT_CONFIG_KEY env'da
 * (32 bayt: 64 ta hex yoki base64). Format: `v1:<iv>:<tag>:<ciphertext>` (base64).
 * GCM tegi shifrlangan qiymat o'zgartirilsa ochishni rad etadi.
 *
 * Kalitni almashtirish — barcha tenantlar kalitlarini qayta kiritishni talab
 * qiladi (kalit rotatsiyasi hozircha qo'llab-quvvatlanmaydi).
 */
const VERSION = 'v1';

export function parsePaymentConfigKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("PAYMENT_CONFIG_KEY env o'zgaruvchisi majburiy (to'lov kalitlarini shifrlash uchun)");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error("PAYMENT_CONFIG_KEY 32 bayt bo'lishi kerak (64 hex yoki base64)");
  return key;
}

export function encryptConfig(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptConfig<T>(blob: string, key: Buffer): T {
  const [version, iv, tag, data] = blob.split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error("To'lov sozlamalari formati noto'g'ri");
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
