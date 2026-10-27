import { timingSafeEqual } from 'crypto';

/**
 * Payme Merchant API (JSON-RPC 2.0). Barcha javoblar HTTP 200; xato —
 * `error: { code, message: {ru,uz,en}, data }`.
 *
 * Tranzaksiya holatlari: 1 yaratilgan · 2 bajarilgan (pul olingan) ·
 * -1 bajarilmasdan bekor · -2 bajarilgandan keyin bekor (qaytarish).
 * Summa — tiyinda (1 so'm = 100 tiyin). Yaratilgan tranzaksiya 12 soatdan
 * keyin bajarilmaydi (sabab 4).
 */
export const PAYME_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export const PAYME_ERROR = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  PARSE_ERROR: -32700,
  INSUFFICIENT_PRIVILEGE: -32504,
  SYSTEM_ERROR: -32400,
  WRONG_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANT_CANCEL: -31007,
  CANT_PERFORM: -31008,
  ORDER_NOT_FOUND: -31050,
  ORDER_UNAVAILABLE: -31051,
  ORDER_HAS_TRANSACTION: -31099,
} as const;

const MESSAGES: Record<number, { ru: string; uz: string; en: string }> = {
  [PAYME_ERROR.INVALID_REQUEST]: { ru: 'Неверный запрос', uz: "Noto'g'ri so'rov", en: 'Invalid request' },
  [PAYME_ERROR.METHOD_NOT_FOUND]: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' },
  [PAYME_ERROR.PARSE_ERROR]: { ru: 'Ошибка разбора JSON', uz: 'JSON xato', en: 'Parse error' },
  [PAYME_ERROR.INSUFFICIENT_PRIVILEGE]: { ru: 'Недостаточно привилегий', uz: 'Huquq yetarli emas', en: 'Insufficient privilege' },
  [PAYME_ERROR.SYSTEM_ERROR]: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' },
  [PAYME_ERROR.WRONG_AMOUNT]: { ru: 'Неверная сумма', uz: "Noto'g'ri summa", en: 'Wrong amount' },
  [PAYME_ERROR.TRANSACTION_NOT_FOUND]: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' },
  [PAYME_ERROR.CANT_CANCEL]: { ru: 'Невозможно отменить транзакцию', uz: 'Tranzaksiyani bekor qilib bo\'lmaydi', en: 'Unable to cancel transaction' },
  [PAYME_ERROR.CANT_PERFORM]: { ru: 'Невозможно выполнить операцию', uz: 'Amalni bajarib bo\'lmaydi', en: 'Unable to perform operation' },
  [PAYME_ERROR.ORDER_NOT_FOUND]: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' },
  [PAYME_ERROR.ORDER_UNAVAILABLE]: { ru: 'Заказ недоступен для оплаты', uz: "Buyurtmani to'lab bo'lmaydi", en: 'Order is not payable' },
  [PAYME_ERROR.ORDER_HAS_TRANSACTION]: { ru: 'По заказу уже есть транзакция', uz: 'Buyurtma bo\'yicha tranzaksiya mavjud', en: 'Order already has a transaction' },
};

export class PaymeRpcError extends Error {
  constructor(
    public readonly code: number,
    public readonly data?: string,
  ) {
    super(MESSAGES[code]?.en ?? 'Error');
  }

  toJSON() {
    return { code: this.code, message: MESSAGES[this.code] ?? MESSAGES[PAYME_ERROR.SYSTEM_ERROR], data: this.data };
  }
}

/** `Authorization: Basic base64("Paycom:<key>")` */
export function verifyPaymeAuth(header: string | undefined, key: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const expected = Buffer.from(`Paycom:${key}`);
  const actual = Buffer.from(Buffer.from(header.slice(6), 'base64').toString('utf8'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface PaymeOrder {
  id: string;
  totalTiyin: number;
  /** awaiting_payment holatida va payme usuli tanlangan */
  payable: boolean;
}

export interface PaymeTx {
  /** Payme tranzaksiya id */
  id: string;
  orderId: string;
  /** bizning ichki id (javobdagi `transaction`) */
  ourId: string;
  state: 1 | 2 | -1 | -2;
  amountTiyin: number;
  createTime: number;
  performTime: number;
  cancelTime: number;
  reason: number | null;
}

export interface PaymeStore {
  findOrder(orderId: string): Promise<PaymeOrder | null>;
  findTx(paymeId: string): Promise<PaymeTx | null>;
  /** state 1 yoki 2 dagi tranzaksiya */
  findOpenTxByOrder(orderId: string): Promise<PaymeTx | null>;
  createTx(orderId: string, paymeId: string, amountTiyin: number, createTime: number): Promise<PaymeTx>;
  /** state → 2; buyurtma to'langan (bitta tranzaksiyada) */
  performTx(tx: PaymeTx, now: number): Promise<PaymeTx>;
  /** state 1 → -1, state 2 → -2; buyurtma holati shunga mos yangilanadi */
  cancelTx(tx: PaymeTx, reason: number, now: number): Promise<PaymeTx>;
  /** To'langan buyurtmani qaytarish mumkinmi (taom hali berilmagan) */
  canRefund(tx: PaymeTx): Promise<boolean>;
  statement(from: number, to: number): Promise<PaymeTx[]>;
}

export interface RpcRequest {
  id?: number | string | null;
  method?: string;
  params?: Record<string, any>;
}

export class PaymeProtocol {
  constructor(
    private readonly store: PaymeStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** JSON-RPC javobi: { id, result } yoki { id, error } */
  async handle(body: RpcRequest): Promise<{ id: unknown; result?: unknown; error?: unknown }> {
    const id = body?.id ?? null;
    try {
      if (!body || typeof body.method !== 'string' || typeof body.params !== 'object' || body.params === null) {
        throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST);
      }
      return { id, result: await this.dispatch(body.method, body.params) };
    } catch (e) {
      if (e instanceof PaymeRpcError) return { id, error: e.toJSON() };
      throw e; // kutilmagan xato — kontroller SYSTEM_ERROR qaytaradi va log qiladi
    }
  }

  private dispatch(method: string, p: Record<string, any>): Promise<unknown> {
    switch (method) {
      case 'CheckPerformTransaction':
        return this.checkPerform(p);
      case 'CreateTransaction':
        return this.create(p);
      case 'PerformTransaction':
        return this.perform(p);
      case 'CancelTransaction':
        return this.cancel(p);
      case 'CheckTransaction':
        return this.check(p);
      case 'GetStatement':
        return this.statement(p);
      default:
        throw new PaymeRpcError(PAYME_ERROR.METHOD_NOT_FOUND);
    }
  }

  /** Buyurtmani topadi va to'lash mumkinligini/summani tekshiradi. */
  private async requirePayable(p: Record<string, any>, requirePayable = true): Promise<PaymeOrder> {
    const orderId = p.account?.order_id;
    if (typeof orderId !== 'string' || !orderId) throw new PaymeRpcError(PAYME_ERROR.ORDER_NOT_FOUND, 'order_id');

    const order = await this.store.findOrder(orderId);
    if (!order) throw new PaymeRpcError(PAYME_ERROR.ORDER_NOT_FOUND, 'order_id');
    if (!Number.isInteger(p.amount) || p.amount !== order.totalTiyin) throw new PaymeRpcError(PAYME_ERROR.WRONG_AMOUNT);
    if (requirePayable && !order.payable) throw new PaymeRpcError(PAYME_ERROR.ORDER_UNAVAILABLE, 'order_id');
    return order;
  }

  private async checkPerform(p: Record<string, any>) {
    await this.requirePayable(p);
    return { allow: true };
  }

  private async create(p: Record<string, any>) {
    if (typeof p.id !== 'string' || !p.id) throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST);

    const existing = await this.store.findTx(p.id);
    if (existing) {
      // Takror CreateTransaction — shu tranzaksiyaning holati (idempotent).
      if (existing.state !== 1) throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);
      if (this.expired(existing)) {
        await this.store.cancelTx(existing, 4, this.now());
        throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);
      }
      return { create_time: existing.createTime, transaction: existing.ourId, state: existing.state };
    }

    const order = await this.requirePayable(p);

    const open = await this.store.findOpenTxByOrder(order.id);
    if (open) {
      // Boshqa Payme tranzaksiyasi bu buyurtma uchun ochiq. Eskirgan bo'lsa yopamiz.
      if (open.state === 1 && this.expired(open)) await this.store.cancelTx(open, 4, this.now());
      else throw new PaymeRpcError(PAYME_ERROR.ORDER_HAS_TRANSACTION, 'order_id');
    }

    const tx = await this.store.createTx(order.id, p.id, p.amount, p.time ?? this.now());
    return { create_time: tx.createTime, transaction: tx.ourId, state: tx.state };
  }

  private async perform(p: Record<string, any>) {
    const tx = await this.requireTx(p.id);

    if (tx.state === 2) return this.performResult(tx); // idempotent
    if (tx.state !== 1) throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);

    if (this.expired(tx)) {
      await this.store.cancelTx(tx, 4, this.now());
      throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);
    }

    // Buyurtma bu orada bekor bo'lgan bo'lsa pul olinmaydi.
    const order = await this.store.findOrder(tx.orderId);
    if (!order || !order.payable) throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);

    return this.performResult(await this.store.performTx(tx, this.now()));
  }

  private performResult(tx: PaymeTx) {
    return { transaction: tx.ourId, perform_time: tx.performTime, state: tx.state };
  }

  private async cancel(p: Record<string, any>) {
    const tx = await this.requireTx(p.id);
    const reason = Number.isInteger(p.reason) ? p.reason : 10;

    if (tx.state === 1) {
      return this.cancelResult(await this.store.cancelTx(tx, reason, this.now()));
    }
    if (tx.state === 2) {
      // Pul olingan: taom allaqachon berilgan bo'lsa qaytarib bo'lmaydi.
      if (!(await this.store.canRefund(tx))) throw new PaymeRpcError(PAYME_ERROR.CANT_CANCEL);
      return this.cancelResult(await this.store.cancelTx(tx, reason, this.now()));
    }
    return this.cancelResult(tx); // allaqachon bekor — idempotent
  }

  private cancelResult(tx: PaymeTx) {
    return { transaction: tx.ourId, cancel_time: tx.cancelTime, state: tx.state };
  }

  private async check(p: Record<string, any>) {
    const tx = await this.requireTx(p.id);
    return {
      create_time: tx.createTime,
      perform_time: tx.performTime,
      cancel_time: tx.cancelTime,
      transaction: tx.ourId,
      state: tx.state,
      reason: tx.reason,
    };
  }

  private async statement(p: Record<string, any>) {
    if (!Number.isFinite(p.from) || !Number.isFinite(p.to)) throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST);
    const list = await this.store.statement(p.from, p.to);
    return {
      transactions: list.map((tx) => ({
        id: tx.id,
        time: tx.createTime,
        amount: tx.amountTiyin,
        account: { order_id: tx.orderId },
        create_time: tx.createTime,
        perform_time: tx.performTime,
        cancel_time: tx.cancelTime,
        transaction: tx.ourId,
        state: tx.state,
        reason: tx.reason,
      })),
    };
  }

  private async requireTx(id: unknown): Promise<PaymeTx> {
    if (typeof id !== 'string' || !id) throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND);
    const tx = await this.store.findTx(id);
    if (!tx) throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND);
    return tx;
  }

  private expired(tx: PaymeTx): boolean {
    return this.now() - tx.createTime > PAYME_TIMEOUT_MS;
  }
}
