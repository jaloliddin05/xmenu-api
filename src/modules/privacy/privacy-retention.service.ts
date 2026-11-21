import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { FINAL_STATUSES } from 'src/modules/order/domain/order-state-machine';
import {
  ORDER_HAS_PII,
  ORDER_PII_CLEARED,
} from 'src/modules/customer/services/customer-anonymizer.service';
import { retentionCutoffs } from './retention-cutoffs';

export const RETENTION_BATCH = 500;

export interface RetentionResult {
  orders: number;
  staffAuthEvents: number;
  staffSessions: number;
  applications: number;
}

/**
 * Daily retention: anonymizes old orders and deletes old audit rows and landing applications.
 * In batches and idempotent: a repeated or interrupted run just finds less to do.
 */
@Injectable()
export class PrivacyRetentionService {
  private readonly logger = new Logger('PrivacyRetention');

  constructor(private readonly prisma: PrismaService) {}

  async run(
    now = new Date(),
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<RetentionResult> {
    const cut = retentionCutoffs(now, env);
    const result: RetentionResult = {
      // Only finished orders: an unfinished old order is a problem for the venue, not for retention
      orders: await this.inBatches(
        (take) =>
          this.prisma.customer_order.findMany({
            where: {
              created_at: { lt: cut.orders },
              status: { in: [...FINAL_STATUSES] },
              ...ORDER_HAS_PII,
            },
            select: { id: true },
            take,
          }),
        (ids) =>
          this.prisma.customer_order.updateMany({
            where: { id: { in: ids } },
            data: ORDER_PII_CLEARED,
          }),
      ),
      staffAuthEvents: await this.inBatches(
        (take) =>
          this.prisma.staff_auth_event.findMany({
            where: { created_at: { lt: cut.staffAuthEvents } },
            select: { id: true },
            take,
          }),
        (ids) =>
          this.prisma.staff_auth_event.deleteMany({
            where: { id: { in: ids } },
          }),
      ),
      staffSessions: await this.inBatches(
        (take) =>
          this.prisma.staff_session.findMany({
            where: { expires_at: { lt: cut.staffSessions } },
            select: { id: true },
            take,
          }),
        (ids) =>
          this.prisma.staff_session.deleteMany({ where: { id: { in: ids } } }),
      ),
      applications: await this.inBatches(
        (take) =>
          this.prisma.application.findMany({
            where: { created_at: { lt: cut.applications } },
            select: { id: true },
            take,
          }),
        (ids) =>
          this.prisma.application.deleteMany({ where: { id: { in: ids } } }),
      ),
    };
    this.logger.log(
      `retention: orders anonymized=${result.orders} staff_auth_event deleted=${result.staffAuthEvents} ` +
        `staff_session deleted=${result.staffSessions} application deleted=${result.applications}`,
    );
    return result;
  }

  /** Repeats find + act until a batch comes back short; returns how many rows were handled. */
  private async inBatches<I extends string | bigint>(
    find: (take: number) => Promise<{ id: I }[]>,
    act: (ids: I[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await find(RETENTION_BATCH);
      if (rows.length === 0) break;
      const { count } = await act(rows.map((r) => r.id));
      total += count;
      if (rows.length < RETENTION_BATCH) break;
    }
    return total;
  }
}
