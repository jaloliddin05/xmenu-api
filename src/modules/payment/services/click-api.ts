import { createHash } from 'crypto';
import axios from 'axios';
import { ClickConfig } from '../domain/payment-url';

/**
 * Click Merchant API: to'lovni qaytarish (reversal).
 *   DELETE https://api.click.uz/v2/merchant/payment/reversal/{service_id}/{payment_id}
 *   Auth: <merchant_user_id>:<sha1(timestamp + secret_key)>:<timestamp>
 * payment_id — Click'ning click_paydoc_id si (prepare/complete'da keladi).
 *
 * DIQQAT: Click sandbox'ida tekshirilmagan — merchant akkaunt bilan birinchi
 * qaytarishni test rejimida sinab ko'ring (docs/BACKEND_ORDERS.md).
 */
export function clickAuthHeader(cfg: Pick<ClickConfig, 'merchantUserId' | 'secretKey'>, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const digest = createHash('sha1').update(`${nowSeconds}${cfg.secretKey}`).digest('hex');
  return `${cfg.merchantUserId}:${digest}:${nowSeconds}`;
}

export async function clickReversePayment(cfg: ClickConfig, paymentId: string): Promise<void> {
  const { data } = await axios.delete(
    `https://api.click.uz/v2/merchant/payment/reversal/${encodeURIComponent(cfg.serviceId)}/${encodeURIComponent(paymentId)}`,
    { headers: { Accept: 'application/json', 'Content-Type': 'application/json', Auth: clickAuthHeader(cfg) }, timeout: 15000 },
  );
  if (data?.error_code !== 0) {
    throw new Error(`Click reversal rejected: ${data?.error_code} ${data?.error_note ?? ''}`);
  }
}
