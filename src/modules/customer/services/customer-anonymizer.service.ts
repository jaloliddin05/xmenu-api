import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { AppException } from 'src/infra/errors/app-exception';
import { ACTIVE_STATUSES } from 'src/modules/order/domain/order-state-machine';

/** What an anonymization changed (or, in a dry run, would change). */
export interface AnonymizeGuestResult {
  customerId: string;
  dryRun: boolean;
  addresses: number;
  sessions: number;
  authEvents: number;
  orders: number;
}

/**
 * Personal data of a guest order. Items, sums, statuses and dates stay: the venue keeps them for its reports.
 * Every new column with personal data must be nulled here and get a retention period (CLAUDE.md, "Персональные данные").
 */
export const ORDER_PII_CLEARED = {
  phone: null,
  comment: null,
  address_snapshot: Prisma.DbNull,
  guest_telegram_id: null,
  guest_telegram_bot_id: null,
} satisfies Prisma.customer_orderUpdateManyMutationInput;

/** An order that still holds personal data (so a repeated run finds nothing to do). */
export const ORDER_HAS_PII: Prisma.customer_orderWhereInput = {
  OR: [
    { phone: { not: null } },
    { comment: { not: null } },
    { address_snapshot: { not: Prisma.DbNull } },
    { guest_telegram_id: { not: null } },
    { guest_telegram_bot_id: { not: null } },
  ],
};

/**
 * Shared by DELETE /customers/me, the retention job and the manual script: one place that knows which columns
 * hold a guest's personal data.
 */
@Injectable()
export class CustomerAnonymizerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Account deletion: the guest row keeps only its id (orders point at it), everything personal is removed.
   * Refused while an order is unfinished, so a courier or the kitchen never works on an order without a phone.
   */
  async deleteGuest(
    tenantId: string,
    customerId: string,
    opts: { dryRun?: boolean } = {},
  ): Promise<AnonymizeGuestResult> {
    const dryRun = opts.dryRun ?? false;
    return this.prisma.$transaction(async (tx) => {
      // Serializes with a concurrent login or order of the same guest
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "customer"
        WHERE "id" = ${customerId} AND "organization_id" = ${tenantId} AND "deleted_at" IS NULL
        FOR UPDATE`;
      if (locked.length === 0)
        throw new AppException('not_found', { message: 'Customer not found' });

      const activeOrders = await tx.customer_order.count({
        where: {
          customer_id: customerId,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      if (activeOrders > 0)
        throw new AppException('has_active_orders', {
          details: { activeOrders },
        });

      const ordersWhere: Prisma.customer_orderWhereInput = {
        customer_id: customerId,
        organization_id: tenantId,
        ...ORDER_HAS_PII,
      };
      if (dryRun) {
        const [addresses, sessions, authEvents, orders] = await Promise.all([
          tx.customer_address.count({ where: { customer_id: customerId } }),
          tx.customer_session.count({ where: { customer_id: customerId } }),
          tx.customer_auth_event.count({
            where: { customer_id: customerId, ...EVENT_HAS_PII },
          }),
          tx.customer_order.count({ where: ordersWhere }),
        ]);
        return {
          customerId,
          dryRun,
          addresses,
          sessions,
          authEvents,
          orders,
        };
      }

      await tx.customer.update({
        where: { id: customerId },
        data: {
          deleted_at: new Date(),
          phone: null,
          name: null,
          telegram_id: null,
          language: null,
          telegram_unreachable_at: null,
          telegram_unreachable_reason: null,
        },
      });
      const addresses = await tx.customer_address.deleteMany({
        where: { customer_id: customerId },
      });
      const sessions = await tx.customer_session.deleteMany({
        where: { customer_id: customerId },
      });
      const authEvents = await tx.customer_auth_event.updateMany({
        where: { customer_id: customerId, ...EVENT_HAS_PII },
        data: EVENT_PII_CLEARED,
      });
      const orders = await tx.customer_order.updateMany({
        where: ordersWhere,
        data: ORDER_PII_CLEARED,
      });
      return {
        customerId,
        dryRun,
        addresses: addresses.count,
        sessions: sessions.count,
        authEvents: authEvents.count,
        orders: orders.count,
      };
    });
  }

  /** Finds a live guest by the phone the venue knows; null if there is none. */
  async findGuestId(tenantId: string, phone: string): Promise<string | null> {
    const row = await this.prisma.customer.findFirst({
      where: { organization_id: tenantId, phone, deleted_at: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }
}

const EVENT_HAS_PII: Prisma.customer_auth_eventWhereInput = {
  OR: [
    { phone_masked: { not: null } },
    { ip: { not: null } },
    { user_agent: { not: null } },
  ],
};

const EVENT_PII_CLEARED = {
  phone_masked: null,
  ip: null,
  user_agent: null,
} satisfies Prisma.customer_auth_eventUpdateManyMutationInput;
