import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  acceptDeadlineAt,
  attention,
  byStatusSince,
  itemsSummary,
  shortAddress,
  statusEntry,
  tashkentDayStart,
  type BoardEvent,
} from '../domain/order-board';
import { LIVE_STATUSES, OrderStatusName } from '../domain/order-state-machine';
import { OrderSettingsService } from './order-settings.service';
import { posReminders } from './pos-reminders';

/**
 * GET /order/board (docs/API.md, "Доска заказов"): every live order of the venue (or one branch) without
 * pagination, light: no guest name or phone, no history. Details stay in GET /order/:id.
 */
@Injectable()
export class OrderBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrderSettingsService,
  ) {}

  async board(organizationId: string, branchId?: string) {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, organization_id: organizationId },
        select: { id: true },
      });
      if (!branch)
        throw new AppException('not_found', { message: 'Branch not found' });
    }
    const now = new Date();
    const scope = {
      organization_id: organizationId,
      ...(branchId ? { branch_id: branchId } : {}),
    };
    const dayStart = tashkentDayStart(now);

    const [settings, pos, rows, placedToday, completedToday] =
      await Promise.all([
        this.settings.get(organizationId),
        posReminders(this.prisma, organizationId),
        this.prisma.customer_order.findMany({
          where: { ...scope, status: { in: [...LIVE_STATUSES] } },
          select: {
            id: true,
            number: true,
            status: true,
            fulfillment: true,
            version: true,
            created_at: true,
            address_snapshot: true,
            total: true,
            currency: true,
            payment_method: true,
            cash_change_from: true,
            courier_id: true,
            ready_at: true,
            picked_up_at: true,
            courier: { select: { id: true, name: true } },
            pos_order: { select: { state: true } },
            items: { select: { name: true, quantity: true, position: true } },
            events: {
              select: { from_status: true, to_status: true, created_at: true },
              orderBy: { id: 'desc' },
            },
          },
        }),
        this.prisma.customer_order.count({
          where: { ...scope, placed_at: { gte: dayStart } },
        }),
        this.prisma.customer_order.aggregate({
          where: {
            ...scope,
            status: 'completed',
            completed_at: { gte: dayStart },
          },
          _count: { _all: true },
          _sum: { total: true },
        }),
      ]);

    const thresholds = {
      pickupReminderMinutes: settings.pickupReminderMinutes,
      onTheWayAlertMinutes: settings.onTheWayAlertMinutes,
      doorWaitMinutes: settings.doorWaitMinutes,
      acceptanceTimeoutSeconds: settings.acceptanceTimeoutSeconds,
      ...pos,
    };

    const items = rows
      .map((o) => {
        const status = o.status as OrderStatusName;
        const entry = statusEntry(status, o.events as BoardEvent[]);
        const since = entry?.created_at ?? o.created_at;
        return {
          id: o.id,
          number: o.number,
          status,
          fulfillmentMode: o.fulfillment,
          createdAt: o.created_at.toISOString(),
          statusSince: since.toISOString(),
          acceptDeadlineAt:
            acceptDeadlineAt(
              status,
              since,
              settings.acceptanceTimeoutSeconds,
            )?.toISOString() ?? null,
          shortAddress: shortAddress(o.address_snapshot),
          ...itemsSummary(o.items),
          total: o.total,
          currency: o.currency,
          paymentMethod: o.payment_method,
          cashChangeFrom: o.cash_change_from,
          courier: o.courier,
          attention: attention(
            {
              status,
              fulfillment: o.fulfillment,
              created_at: o.created_at,
              courier_id: o.courier_id,
              ready_at: o.ready_at,
              picked_up_at: o.picked_up_at,
              pos_state: o.pos_order?.state ?? null,
            },
            entry?.from_status ?? null,
            thresholds,
            now,
          ),
          version: o.version,
        };
      })
      .sort(byStatusSince);

    const completedCount = completedToday._count._all;
    return {
      serverTime: now.toISOString(),
      items,
      thresholds,
      today: {
        ordersCount: placedToday,
        completedCount,
        revenue: completedToday._sum.total ?? 0,
      },
      completedTodayCount: completedCount,
    };
  }
}
