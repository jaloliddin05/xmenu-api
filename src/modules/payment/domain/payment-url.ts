export interface ClickConfig {
  merchantId: string;
  serviceId: string;
  merchantUserId: string;
  secretKey: string;
}

export interface PaymeConfig {
  merchantId: string;
  /** Payme kabinetidagi "Ключ" (Basic auth paroli) */
  key: string;
}

export interface PayableOrder {
  id: string;
  /** butun so'm */
  total: number;
}

/**
 * Mijozni to'lovga yo'naltiradigan havola. Deterministik — bazaga yozilmaydi,
 * har safar buyurtma va tenant sozlamasidan qayta quriladi (GET /orders/:id
 * qayta ochilganda ham ishlaydi).
 *
 *  Click: https://my.click.uz/services/pay?service_id&merchant_id&amount&transaction_param&return_url
 *  Payme: https://checkout.paycom.uz/<base64("m=..;ac.order_id=..;a=<tiyin>;c=<return>;l=ru;cr=860")>
 */
export function buildClickUrl(cfg: ClickConfig, order: PayableOrder, returnUrl?: string): string {
  const q = new URLSearchParams({
    service_id: cfg.serviceId,
    merchant_id: cfg.merchantId,
    amount: order.total.toFixed(2),
    transaction_param: order.id,
  });
  if (returnUrl) q.set('return_url', returnUrl);
  return `https://my.click.uz/services/pay?${q.toString()}`;
}

export function buildPaymeUrl(cfg: PaymeConfig, order: PayableOrder, returnUrl?: string, lang: 'ru' | 'uz' | 'en' = 'ru'): string {
  const parts = [`m=${cfg.merchantId}`, `ac.order_id=${order.id}`, `a=${order.total * 100}`, 'cr=860', `l=${lang}`];
  if (returnUrl) parts.push(`c=${returnUrl}`);
  return `https://checkout.paycom.uz/${Buffer.from(parts.join(';')).toString('base64')}`;
}

/** MINIAPP_RETURN_URL ("https://.../order/{orderId}") yoki MINIAPP_URL + /order/{orderId}; sozlanmagan bo'lsa undefined. */
export function resolveReturnUrl(orderId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const template = env.MINIAPP_RETURN_URL || (env.MINIAPP_URL ? `${env.MINIAPP_URL.replace(/\/$/, '')}/order/{orderId}` : undefined);
  return template?.replace('{orderId}', encodeURIComponent(orderId));
}
