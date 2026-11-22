import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  InvalidTransitionError,
  OrderNotFoundError,
  OrderTransitionService,
} from '../services/order-transition.service';
import { PAYMENT_EXPIRED_REASON } from '../domain/order-state-machine';

export const PAYMENT_FAILED_TTL_DEFAULT_HOURS = 24;
const BATCH = 200;

/** PAYMENT_FAILED_TTL_HOURS (env-schema.ts) in ms; 24 hours when unset or not a positive number. */
export function paymentFailedTtlMs(env: NodeJS.ProcessEnv = process.env) {
  const raw = Number.parseInt(env.PAYMENT_FAILED_TTL_HOURS ?? '', 10);
  const hours =
    Number.isFinite(raw) && raw >= 1 ? raw : PAYMENT_FAILED_TTL_DEFAULT_HOURS;
  return hours * 3600_000;
}

/**
 * An order stays in payment_failed until the guest pays again or cancels. One the guest left there is cancelled
 * by the system PAYMENT_FAILED_TTL_HOURS after it got there (the last journal entry into payment_failed): it no
 * longer counts as unfinished (account and venue deletion, order limits) and retention can anonymize it.
 * Idempotent: a guest who paid again or cancelled in the meantime is left alone (expectedFrom).
 */
@Injectable()
export class PaymentFailedExpiryService {
  private readonly logger = new Logger('PaymentFailedExpiry');

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
  ) {}

  async run(
    now = new Date(),
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - paymentFailedTtlMs(env));
    let cancelled = 0;
    let after: string | undefined;
    for (;;) {
      const batch = await this.prisma.customer_order.findMany({
        where: {
          status: 'payment_failed',
          events: {
            none: { to_status: 'payment_failed', created_at: { gte: cutoff } },
          },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      for (const { id } of batch) {
        try {
          await this.transitions.transition({
            orderId: id,
            to: 'cancelled',
            actor: 'system',
            expectedFrom: 'payment_failed',
            reason: PAYMENT_EXPIRED_REASON,
            note: PAYMENT_EXPIRED_REASON,
          });
          cancelled++;
        } catch (e) {
          // The guest paid again or cancelled meanwhile, or the order is gone: nothing to do
          if (
            e instanceof InvalidTransitionError ||
            e instanceof OrderNotFoundError
          )
            continue;
          throw e;
        }
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1].id;
    }
    if (cancelled > 0)
      this.logger.log(`cancelled ${cancelled} orders left in payment_failed`);
    return cancelled;
  }
}
