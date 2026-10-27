import { createHash, timingSafeEqual } from 'crypto';

/**
 * Click SHOP API (Prepare / Complete). Imzo: MD5 — protokol shuni talab qiladi,
 * bu yerda kriptografik mustahkamlik emas, faqat Click kelishuviga moslik.
 * Taqqoslash timingSafeEqual bilan.
 *
 * Xato kodlari (Click hujjati): 0 OK · -1 imzo noto'g'ri · -2 summa noto'g'ri ·
 * -3 action topilmadi · -4 allaqachon to'langan · -5 buyurtma topilmadi ·
 * -6 tranzaksiya topilmadi · -7 yangilab bo'lmadi · -8 so'rovda xato ·
 * -9 tranzaksiya bekor qilingan.
 */
export const CLICK_ERROR = {
  OK: 0,
  SIGN_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  ORDER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  BAD_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

const NOTE: Record<number, string> = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'Order not found',
  [-6]: 'Transaction not found',
  [-7]: 'Failed to update user',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
};

export interface ClickRequest {
  click_trans_id?: string;
  service_id?: string;
  click_paydoc_id?: string;
  merchant_trans_id?: string;
  merchant_prepare_id?: string;
  amount?: string;
  action?: string;
  error?: string;
  error_note?: string;
  sign_time?: string;
  sign_string?: string;
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

export function clickSign(req: ClickRequest, secretKey: string): string {
  const base = [req.click_trans_id, req.service_id, secretKey, req.merchant_trans_id];
  const tail = [req.amount, req.action, req.sign_time];
  // Complete (action=1) imzosiga merchant_prepare_id ham kiradi.
  const parts = req.action === '1' ? [...base, req.merchant_prepare_id, ...tail] : [...base, ...tail];
  return md5(parts.map((p) => p ?? '').join(''));
}

export function verifyClickSign(req: ClickRequest, secretKey: string): boolean {
  if (!req.sign_string) return false;
  const expected = Buffer.from(clickSign(req, secretKey));
  const actual = Buffer.from(String(req.sign_string).toLowerCase());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ------------------------------------------------------------- protokol

export interface ClickOrder {
  id: string;
  /** butun so'm */
  total: number;
  /** awaiting_payment holatida va click usuli tanlangan */
  payable: boolean;
  /** allaqachon to'langan */
  paid: boolean;
}

export interface ClickPayment {
  seq: number;
  orderId: string;
  clickTransId: string;
  amount: number;
  status: 'created' | 'paid' | 'cancelled' | 'refunded' | 'failed';
}

export interface ClickStore {
  findOrder(orderId: string): Promise<ClickOrder | null>;
  findPaymentBySeq(seq: number): Promise<ClickPayment | null>;
  findPaymentByClickId(clickTransId: string): Promise<ClickPayment | null>;
  createPayment(orderId: string, clickTransId: string, amount: number, paydocId: string | undefined): Promise<ClickPayment>;
  /**
   * To'lovni "paid" qiladi va buyurtmani pending_acceptance ga o'tkazadi (bitta
   * tranzaksiyada, buyurtma qatori bloklangan holda). Buyurtma shu orada bekor
   * bo'lgan bo'lsa pul olinmaydi: to'lov bekor qilinadi va false qaytadi.
   */
  markPaid(payment: ClickPayment): Promise<boolean>;
  markCancelled(payment: ClickPayment, reason: string): Promise<void>;
}

export interface ClickResponse {
  click_trans_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: number;
  merchant_confirm_id?: number;
  error: number;
  error_note: string;
}

export class ClickProtocol {
  constructor(
    private readonly store: ClickStore,
    private readonly cfg: { serviceId: string; secretKey: string },
  ) {}

  async handle(action: 'prepare' | 'complete', req: ClickRequest): Promise<ClickResponse> {
    const base = {
      click_trans_id: String(req.click_trans_id ?? ''),
      merchant_trans_id: String(req.merchant_trans_id ?? ''),
    };
    const reply = (error: number, extra: Partial<ClickResponse> = {}): ClickResponse => ({
      ...base,
      ...extra,
      error,
      error_note: NOTE[error] ?? 'Error',
    });

    if (!req.click_trans_id || !req.merchant_trans_id || !req.amount || !req.sign_time) {
      return reply(CLICK_ERROR.BAD_REQUEST);
    }
    if (String(req.service_id) !== String(this.cfg.serviceId)) return reply(CLICK_ERROR.BAD_REQUEST);
    if (!verifyClickSign(req, this.cfg.secretKey)) return reply(CLICK_ERROR.SIGN_FAILED);

    const expectedAction = action === 'prepare' ? '0' : '1';
    if (req.action !== expectedAction) return reply(CLICK_ERROR.ACTION_NOT_FOUND);

    const order = await this.store.findOrder(req.merchant_trans_id);
    if (!order) return reply(CLICK_ERROR.ORDER_NOT_FOUND);

    const amount = Number(req.amount);
    if (!Number.isFinite(amount) || Math.abs(amount - order.total) > 0.001) {
      return reply(CLICK_ERROR.INCORRECT_AMOUNT);
    }

    return action === 'prepare' ? this.prepare(req, order, reply) : this.complete(req, order, reply);
  }

  private async prepare(
    req: ClickRequest,
    order: ClickOrder,
    reply: (e: number, x?: Partial<ClickResponse>) => ClickResponse,
  ): Promise<ClickResponse> {
    if (order.paid) return reply(CLICK_ERROR.ALREADY_PAID);
    if (!order.payable) return reply(CLICK_ERROR.TRANSACTION_CANCELLED);

    // Takror prepare (Click qayta yuborishi mumkin) — o'sha tranzaksiyani qaytaramiz.
    const existing = await this.store.findPaymentByClickId(req.click_trans_id!);
    const payment = existing ?? (await this.store.createPayment(order.id, req.click_trans_id!, order.total, req.click_paydoc_id));
    if (payment.status === 'cancelled' || payment.status === 'failed') return reply(CLICK_ERROR.TRANSACTION_CANCELLED);
    if (payment.status === 'paid') return reply(CLICK_ERROR.ALREADY_PAID);

    return reply(CLICK_ERROR.OK, { merchant_prepare_id: payment.seq });
  }

  private async complete(
    req: ClickRequest,
    order: ClickOrder,
    reply: (e: number, x?: Partial<ClickResponse>) => ClickResponse,
  ): Promise<ClickResponse> {
    const seq = Number(req.merchant_prepare_id);
    const payment = Number.isInteger(seq) ? await this.store.findPaymentBySeq(seq) : null;
    if (!payment || payment.orderId !== order.id || payment.clickTransId !== req.click_trans_id) {
      return reply(CLICK_ERROR.TRANSACTION_NOT_FOUND);
    }

    // Takror complete — natija o'zgarmaydi (idempotent).
    if (payment.status === 'paid') return reply(CLICK_ERROR.ALREADY_PAID, { merchant_confirm_id: payment.seq });
    if (payment.status === 'cancelled' || payment.status === 'failed') {
      return reply(CLICK_ERROR.TRANSACTION_CANCELLED);
    }

    // Click o'zi to'lov xatosini bildirdi (error < 0) — tranzaksiyani yopamiz.
    if (Number(req.error) < 0) {
      await this.store.markCancelled(payment, `click_error_${req.error}`);
      return reply(CLICK_ERROR.TRANSACTION_CANCELLED);
    }

    // Prepare'dan keyin buyurtma bekor bo'lgan (mijoz bekor qildi / muddat tugadi):
    // pul olinmasligi kerak.
    if (!order.payable) {
      await this.store.markCancelled(payment, 'order_not_payable');
      return reply(CLICK_ERROR.TRANSACTION_CANCELLED);
    }

    if (!(await this.store.markPaid(payment))) return reply(CLICK_ERROR.TRANSACTION_CANCELLED);
    return reply(CLICK_ERROR.OK, { merchant_confirm_id: payment.seq });
  }
}
