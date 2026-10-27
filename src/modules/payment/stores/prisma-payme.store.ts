import { order_payment } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderTransitionService, TransitionResult } from 'src/modules/order/services/order-transition.service';
import {
  PAYME_ERROR,
  PAYME_TIMEOUT_MS,
  PaymeOrder,
  PaymeRpcError,
  PaymeStore,
  PaymeTx,
} from '../domain/payme-protocol';
import { lockOrder } from './order-lock';

const toTx = (p: order_payment): PaymeTx => ({
  id: p.provider_transaction_id ?? '',
  orderId: p.order_id,
  ourId: p.id,
  state: (p.provider_state ?? 1) as PaymeTx['state'],
  amountTiyin: p.amount * 100,
  createTime: Number(p.provider_create_time ?? 0),
  performTime: p.performed_at?.getTime() ?? 0,
  cancelTime: p.cancelled_at?.getTime() ?? 0,
  reason: p.cancel_reason,
});

/** Payme Merchant API ↔ bazа. Summalar bazada so'mda, Payme'ga tiyinda (×100). */
export class PrismaPaymeStore implements PaymeStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly organizationId: string,
  ) {}

  private get scope() {
    return { provider: 'payme' as const, order: { organization_id: this.organizationId } };
  }

  async findOrder(orderId: string): Promise<PaymeOrder | null> {
    const o = await this.prisma.customer_order.findFirst({
      where: { id: orderId, organization_id: this.organizationId },
      select: { id: true, total: true, status: true, payment_method: true },
    });
    if (!o) return null;
    return { id: o.id, totalTiyin: o.total * 100, payable: o.status === 'awaiting_payment' && o.payment_method === 'payme' };
  }

  async findTx(paymeId: string) {
    const p = await this.prisma.order_payment.findFirst({ where: { ...this.scope, provider_transaction_id: paymeId } });
    return p ? toTx(p) : null;
  }

  async findOpenTxByOrder(orderId: string) {
    const p = await this.prisma.order_payment.findFirst({ where: { ...this.scope, order_id: orderId, provider_state: { in: [1, 2] } } });
    return p ? toTx(p) : null;
  }

  async createTx(orderId: string, paymeId: string, amountTiyin: number, createTime: number) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const open = await tx.order_payment.findFirst({ where: { provider: 'payme', order_id: orderId, provider_state: { in: [1, 2] } } });
      if (open) throw new PaymeRpcError(PAYME_ERROR.ORDER_HAS_TRANSACTION, 'order_id');

      const p = await tx.order_payment.create({
        data: {
          order_id: orderId,
          provider: 'payme',
          status: 'created',
          amount: amountTiyin / 100,
          provider_transaction_id: paymeId,
          provider_state: 1,
          provider_create_time: BigInt(createTime),
          expires_at: new Date(createTime + PAYME_TIMEOUT_MS),
        },
      });
      return toTx(p);
    });
  }

  async performTx(t: PaymeTx, now: number) {
    const done = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, t.orderId);
      const p = await tx.order_payment.findUniqueOrThrow({ where: { id: t.ourId } });
      const order = await tx.customer_order.findUniqueOrThrow({ where: { id: t.orderId }, select: { status: true } });
      // Qayta tekshiruv blok ostida: protokol qatlami o'qiganidan beri holat o'zgargan bo'lishi mumkin.
      if (p.provider_state !== 1 || order.status !== 'awaiting_payment') throw new PaymeRpcError(PAYME_ERROR.CANT_PERFORM);

      const updated = await tx.order_payment.update({
        where: { id: p.id },
        data: { provider_state: 2, status: 'paid', performed_at: new Date(now) },
      });
      const transition = await this.transitions.transitionInTx(tx, { orderId: t.orderId, to: 'pending_acceptance', actor: 'payment', note: 'payme' });
      return { payment: updated, transition };
    });

    this.transitions.dispatchEffects(done.transition.order, done.transition.effects);
    return toTx(done.payment);
  }

  async cancelTx(t: PaymeTx, reason: number, now: number) {
    const done = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, t.orderId);
      const p = await tx.order_payment.findUniqueOrThrow({ where: { id: t.ourId } });
      const order = await tx.customer_order.findUniqueOrThrow({ where: { id: t.orderId }, select: { status: true } });
      const at = new Date(now);

      if (p.provider_state === 1) {
        const payment = await tx.order_payment.update({
          where: { id: p.id },
          data: { provider_state: -1, status: 'cancelled', cancel_reason: reason, cancelled_at: at },
        });
        // Mijoz qayta to'lashi mumkin: buyurtma payment_failed ga o'tadi (reason 4 = muddat tugadi).
        const transition =
          order.status === 'awaiting_payment'
            ? await this.transitions.transitionInTx(tx, { orderId: t.orderId, to: 'payment_failed', actor: 'payment', note: reason === 4 ? 'expired' : 'cancelled' })
            : null;
        return { payment, transition };
      }

      if (p.provider_state === 2) {
        // Payme pulni qaytardi. Tayyorlanmagan buyurtma bekor qilinadi; pul allaqachon qaytgani uchun
        // OrderTransitionService qo'yadigan "refund" navbat vazifasi kerak emas.
        const payment = await tx.order_payment.update({
          where: { id: p.id },
          data: { provider_state: -2, status: 'refunded', cancel_reason: reason, cancelled_at: at, refunded_at: at },
        });
        let transition: TransitionResult | null = null;
        if (order.status === 'pending_acceptance' || order.status === 'accepted') {
          const result = await this.transitions.transitionInTx(tx, { orderId: t.orderId, to: 'cancelled', actor: 'payment', reason: 'payment_refunded' });
          transition = { ...result, effects: result.effects.filter((e) => e.type !== 'refund') };
        }
        await tx.customer_order.update({ where: { id: t.orderId }, data: { payment_status: 'refunded' } });
        return { payment, transition };
      }

      return { payment: p, transition: null }; // allaqachon bekor
    });

    if (done.transition) this.transitions.dispatchEffects(done.transition.order, done.transition.effects);
    return toTx(done.payment);
  }

  async canRefund(t: PaymeTx): Promise<boolean> {
    const o = await this.prisma.customer_order.findUnique({ where: { id: t.orderId }, select: { status: true } });
    return !!o && ['pending_acceptance', 'accepted', 'cancelled'].includes(o.status);
  }

  async statement(from: number, to: number) {
    const rows = await this.prisma.order_payment.findMany({
      where: { ...this.scope, provider_create_time: { gte: BigInt(from), lte: BigInt(to) } },
      orderBy: { provider_create_time: 'asc' },
    });
    return rows.map(toTx);
  }
}
