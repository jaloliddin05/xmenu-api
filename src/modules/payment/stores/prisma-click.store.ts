import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';
import { ClickOrder, ClickPayment, ClickStore } from '../domain/click-protocol';
import { lockOrder } from './order-lock';

const toPayment = (p: { seq: number; order_id: string; provider_transaction_id: string | null; amount: number; status: any }): ClickPayment => ({
  seq: p.seq,
  orderId: p.order_id,
  clickTransId: p.provider_transaction_id ?? '',
  amount: p.amount,
  status: p.status,
});

/** Click Shop API ↔ bazа. `organizationId` — URL'dagi slug'dan; boshqa tenant buyurtmasiga tegib bo'lmaydi. */
export class PrismaClickStore implements ClickStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly organizationId: string,
  ) {}

  async findOrder(orderId: string): Promise<ClickOrder | null> {
    const o = await this.prisma.customer_order.findFirst({
      where: { id: orderId, organization_id: this.organizationId },
      select: { id: true, total: true, status: true, payment_method: true, payment_status: true },
    });
    if (!o) return null;
    return {
      id: o.id,
      total: o.total,
      payable: o.status === 'awaiting_payment' && o.payment_method === 'click',
      paid: o.payment_status === 'paid',
    };
  }

  async findPaymentBySeq(seq: number) {
    const p = await this.prisma.order_payment.findFirst({
      where: { seq, provider: 'click', order: { organization_id: this.organizationId } },
    });
    return p ? toPayment(p) : null;
  }

  async findPaymentByClickId(clickTransId: string) {
    const p = await this.prisma.order_payment.findFirst({
      where: { provider: 'click', provider_transaction_id: clickTransId, order: { organization_id: this.organizationId } },
    });
    return p ? toPayment(p) : null;
  }

  async createPayment(orderId: string, clickTransId: string, amount: number, paydocId: string | undefined) {
    try {
      const p = await this.prisma.order_payment.create({
        data: { order_id: orderId, provider: 'click', amount, provider_transaction_id: clickTransId, provider_payment_id: paydocId ?? null },
      });
      return toPayment(p);
    } catch (e) {
      // (provider, click_trans_id) unique: parallel takror prepare — mavjudini qaytaramiz
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.findPaymentByClickId(clickTransId);
        if (existing) return existing;
      }
      throw e;
    }
  }

  async markPaid(payment: ClickPayment): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, payment.orderId);
      const order = await tx.customer_order.findUniqueOrThrow({ where: { id: payment.orderId }, select: { status: true } });

      if (order.status !== 'awaiting_payment') {
        // Buyurtma shu orada bekor bo'ldi / muddati tugadi — pul olinmaydi.
        await tx.order_payment.update({ where: { seq: payment.seq }, data: { status: 'cancelled', cancelled_at: new Date() } });
        return null;
      }

      await tx.order_payment.update({ where: { seq: payment.seq }, data: { status: 'paid', performed_at: new Date() } });
      return this.transitions.transitionInTx(tx, { orderId: payment.orderId, to: 'pending_acceptance', actor: 'payment', note: 'click' });
    });

    if (!result) return false;
    this.transitions.dispatchEffects(result.order, result.effects);
    return true;
  }

  async markCancelled(payment: ClickPayment, _reason: string) {
    await this.prisma.order_payment.updateMany({
      where: { seq: payment.seq, status: 'created' },
      data: { status: 'cancelled', cancelled_at: new Date() },
    });
  }
}
