import { paidAtDoor } from '../domain/delivery-payment';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  nextRestaurantStatus,
  OrderStatusName,
} from '../domain/order-state-machine';
import {
  InvalidTransitionError,
  OrderNotFoundError,
  OrderTransitionService,
} from './order-transition.service';
import { OrderWithItems, toOrderView } from './order-view';
import { OrderSettingsService } from './order-settings.service';
import {
  DeliveryTimerSettings,
  doorWaitEndsAt,
} from '../domain/delivery-timers';
import { AppException } from 'src/infra/errors/app-exception';

const INCLUDE = {
  items: { include: { options: true } },
  branch: { select: { id: true, title: true, address: true } },
  customer: { select: { id: true, name: true, phone: true } },
  courier: { select: { id: true, name: true, phone: true } },
  events: { orderBy: { id: 'asc' } },
} satisfies Prisma.customer_orderInclude;

export type RestaurantAction =
  | { type: 'accept' }
  | { type: 'reject'; reason?: string }
  | { type: 'next' }
  | { type: 'set'; status: OrderStatusName };

type StaffOrderRow = Prisma.customer_orderGetPayload<{
  include: typeof INCLUDE;
}>;

/** Who did a step of the history: the name of the staff member or courier and the staff role */
interface EventActor {
  name: string;
  role: 'owner' | 'operator' | null;
}

const actorKey = (actor: string, id: string) => `${actor}:${id}`;

export interface ActionResult {
  /** false — buyurtma allaqachon shu holatda/o'tib bo'lgan (takror bosish, Telegram'da ikki xodim) */
  changed: boolean;
  status: OrderStatusName;
}

/**
 * Restoran tomoni: panel (API) va Telegram tugmalari BIR XIL joydan o'tadi —
 * ikkalasi ham OrderTransitionService orqali, shuning uchun qoidalar, audit va
 * poyga himoyasi ikkala yo'lda bir xil.
 */
@Injectable()
export class OrderStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly settings: OrderSettingsService,
  ) {}

  /**
   * Names for the history (W13-13): restaurant steps carry the staff user id (a member of this venue, a disabled
   * operator included), courier steps the courier id; one query per kind for all the orders. Ids of another
   * venue or not found stay without a name.
   */
  private async eventActors(
    organizationId: string,
    orders: readonly StaffOrderRow[],
  ): Promise<Map<string, EventActor>> {
    const ids = (actor: string) => [
      ...new Set(
        orders.flatMap((o) =>
          o.events
            .filter((e) => e.actor === actor && e.actor_id)
            .map((e) => e.actor_id as string),
        ),
      ),
    ];
    const staffIds = ids('restaurant');
    const courierIds = ids('courier');
    const [members, couriers] = await Promise.all([
      staffIds.length
        ? this.prisma.organization_member.findMany({
            where: {
              organization_id: organizationId,
              user_id: { in: staffIds },
            },
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              role: true,
            },
          })
        : [],
      courierIds.length
        ? this.prisma.courier.findMany({
            where: { organization_id: organizationId, id: { in: courierIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const out = new Map<string, EventActor>();
    for (const m of members)
      if (m.user_id)
        out.set(actorKey('restaurant', m.user_id), {
          name: [m.first_name, m.last_name].filter(Boolean).join(' '),
          role: m.role,
        });
    for (const c of couriers)
      out.set(actorKey('courier', c.id), { name: c.name, role: null });
    return out;
  }

  private toStaffView(
    order: StaffOrderRow,
    timers: DeliveryTimerSettings,
    actors: ReadonlyMap<string, EventActor>,
  ) {
    const doorEnds = doorWaitEndsAt(order, timers);
    return {
      ...toOrderView(order as unknown as OrderWithItems),
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        phone: order.customer.phone,
      },
      // The operator sees the whole courier, the guest only the name (toOrderView)
      courier: order.courier,
      courierAssignedAt: order.courier_assigned_at?.toISOString() ?? null,
      doorProblemReason: order.door_problem_reason,
      readyAt: order.ready_at?.toISOString() ?? null,
      pickedUpAt: order.picked_up_at?.toISOString() ?? null,
      doorWaitEndsAt: doorEnds?.toISOString() ?? null,
      cashCollected: order.cash_collected,
      external:
        order.external_service && order.external_handed_at
          ? {
              service: order.external_service,
              cost: order.external_cost ?? 0,
              handedAt: order.external_handed_at.toISOString(),
              cashReceived: order.external_cash_received,
              paymentMarkPending:
                order.status === 'handed_to_external' &&
                paidAtDoor(order.payment_method) &&
                order.external_cash_received === null,
            }
          : null,
      events: order.events.map((e) => {
        const who = e.actor_id
          ? actors.get(actorKey(e.actor, e.actor_id))
          : undefined;
        return {
          from: e.from_status,
          to: e.to_status,
          actor: e.actor,
          actorId: e.actor_id,
          actorName: who?.name ?? null,
          actorRole: who?.role ?? null,
          note: e.note,
          at: e.created_at.toISOString(),
        };
      }),
    };
  }

  async list(
    organizationId: string,
    q: {
      statuses?: OrderStatusName[];
      branchId?: string;
      courierId?: string;
      /** Delivery orders waiting for a courier (accepted or ready, nobody assigned) */
      unassigned?: boolean;
      cursor?: string;
      limit?: number;
    },
  ) {
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
    const timers = await this.settings.get(organizationId);
    const rows = await this.prisma.customer_order.findMany({
      where: {
        organization_id: organizationId,
        ...(q.statuses?.length ? { status: { in: q.statuses } } : {}),
        ...(q.branchId ? { branch_id: q.branchId } : {}),
        ...(q.courierId ? { courier_id: q.courierId } : {}),
        ...(q.unassigned
          ? {
              fulfillment: 'delivery' as const,
              courier_id: null,
              status: { in: ['accepted', 'ready'] as OrderStatusName[] },
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: INCLUDE,
    });
    const page = rows.slice(0, limit);
    const actors = await this.eventActors(organizationId, page);
    return {
      items: page.map((o) => this.toStaffView(o, timers, actors)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      // The operator does not read /order-settings: the list carries the timer thresholds for the highlight
      reminders: {
        pickupReminderMinutes: timers.pickupReminderMinutes,
        onTheWayAlertMinutes: timers.onTheWayAlertMinutes,
        doorWaitMinutes: timers.doorWaitMinutes,
      },
    };
  }

  async get(organizationId: string, id: string) {
    const order = await this.prisma.customer_order.findFirst({
      where: { id, organization_id: organizationId },
      include: INCLUDE,
    });
    if (!order)
      throw new AppException('not_found', { message: 'Order not found' });
    const [timers, actors] = await Promise.all([
      this.settings.get(organizationId),
      this.eventActors(organizationId, [order]),
    ]);
    return this.toStaffView(order, timers, actors);
  }

  /** Panel uchun: natijada yangilangan buyurtma. Ruxsat etilmagan o'tish — 409. */
  async act(
    organizationId: string,
    id: string,
    action: RestaurantAction,
    actorId: string,
  ) {
    const result = await this.perform(organizationId, id, action, actorId);
    if (!result.changed && result.conflict) {
      throw new AppException('order_status_conflict', {
        details: { status: result.status },
      });
    }
    return this.get(organizationId, id);
  }

  /**
   * Telegram tugmasi uchun: takror bosish xato emas (changed=false). `organizationId`
   * berilsa buyurtma o'sha tenantga tegishli bo'lishi shart.
   */
  async perform(
    organizationId: string | null,
    id: string,
    action: RestaurantAction,
    actorId: string,
  ): Promise<ActionResult & { conflict: boolean }> {
    const order = await this.prisma.customer_order.findFirst({
      where: {
        id,
        ...(organizationId ? { organization_id: organizationId } : {}),
      },
      select: { status: true, fulfillment: true },
    });
    if (!order)
      throw new AppException('not_found', { message: 'Order not found' });

    const from = order.status as OrderStatusName;
    const to = this.target(action, from, order.fulfillment);
    if (!to) return { changed: false, status: from, conflict: true };

    try {
      await this.transitions.transition({
        orderId: id,
        to,
        actor: 'restaurant',
        actorId,
        reason:
          action.type === 'reject' ? (action.reason ?? 'declined') : undefined,
      });
      return { changed: true, status: to, conflict: false };
    } catch (e) {
      if (e instanceof OrderNotFoundError)
        throw new AppException('not_found', { message: 'Order not found' });
      if (e instanceof InvalidTransitionError) {
        // Allaqachon shu holatda — takror bosish; boshqa holatda — haqiqiy konflikt.
        return { changed: false, status: e.from, conflict: e.from !== to };
      }
      throw e;
    }
  }

  private target(
    action: RestaurantAction,
    from: OrderStatusName,
    fulfillment: string,
  ): OrderStatusName | null {
    switch (action.type) {
      case 'accept':
        return 'accepted';
      case 'reject':
        return 'cancelled';
      case 'set':
        return action.status;
      case 'next':
        return nextRestaurantStatus(from, fulfillment as 'delivery' | 'pickup');
    }
  }
}
