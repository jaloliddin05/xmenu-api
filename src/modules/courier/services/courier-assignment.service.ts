import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  COURIER_HELD_STATUSES,
  COURIER_LOCKED_STATUSES,
  OrderStatusName,
} from 'src/modules/order/domain/order-state-machine';
import { OrderQueueService } from 'src/modules/order/queue/order-queue.service';
import {
  InvalidTransitionError,
  OrderTransitionService,
} from 'src/modules/order/services/order-transition.service';
import { LiveEventBus } from 'src/modules/live/live-event-bus';

/** Statuses in which the operator may assign, reassign or take off the courier (before "picked up"). */
const ASSIGNABLE: readonly OrderStatusName[] = [
  'accepted',
  'preparing',
  'ready',
];

class Conflict extends Error {}

/**
 * Assigning own couriers to delivery orders (docs/DELIVERY.md, "Назначение"): only couriers on shift, several
 * orders per courier, reassign or take off until "picked up"; after that only through "cannot deliver" or the
 * operator's decision (return, cancel). Every change is written to the order journal and rebuilds the cards of
 * the couriers involved.
 */
@Injectable()
export class CourierAssignmentService {
  private readonly logger = new Logger('CourierAssignment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly queues: OrderQueueService,
    @Optional() private readonly live?: LiveEventBus,
  ) {}

  async assign(
    organizationId: string,
    orderId: string,
    courierId: string,
    staffUserId: string,
  ): Promise<void> {
    const result = await this.withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await this.loadOrder(tx, organizationId, orderId);
        const courier = await tx.courier.findFirst({
          where: { id: courierId, organization_id: organizationId },
          include: { shifts: { where: { status: 'open' }, take: 1 } },
        });
        if (!courier)
          throw new AppException('not_found', { message: 'Courier not found' });
        if (!courier.is_active) throw new AppException('courier_inactive');
        const shift = courier.shifts[0];
        if (!shift) throw new AppException('courier_not_on_shift');
        if (order.courier_id === courierId)
          return { order, previous: null, changed: false };

        await this.update(tx, order, {
          courier_id: courierId,
          courier_assigned_at: new Date(),
          courier_shift_id: shift.id,
        });
        await this.transitions.recordInTx(tx, {
          orderId,
          status: order.status as OrderStatusName,
          actor: 'restaurant',
          actorId: staffUserId,
          note: order.courier_id
            ? `courier_reassigned:${courierId}`
            : `courier_assigned:${courierId}`,
        });
        return { order, previous: order.courier_id, changed: true };
      }),
    );
    if (!result.changed) return;
    const version = result.order.version + 1;
    await this.published(organizationId, result.order, version);
    await this.queues.enqueueCourierCard(orderId, courierId, version);
    if (result.previous)
      await this.queues.enqueueCourierCard(orderId, result.previous, version);
  }

  async unassign(
    organizationId: string,
    orderId: string,
    staffUserId: string,
  ): Promise<void> {
    const result = await this.withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await this.loadOrder(tx, organizationId, orderId);
        if (!order.courier_id) return null;
        await this.update(tx, order, {
          courier_id: null,
          courier_assigned_at: null,
          courier_shift_id: null,
        });
        await this.transitions.recordInTx(tx, {
          orderId,
          status: order.status as OrderStatusName,
          actor: 'restaurant',
          actorId: staffUserId,
          note: `courier_unassigned:${order.courier_id}`,
        });
        return {
          courierId: order.courier_id,
          version: order.version + 1,
          order,
        };
      }),
    );
    if (result)
      await this.published(organizationId, result.order, result.version);
    if (result)
      await this.queues.enqueueCourierCard(
        orderId,
        result.courierId,
        result.version,
      );
  }

  /**
   * The courier was disabled: every unfinished order is taken off them and waits for another courier. Before
   * "picked up" the courier is simply removed; an order on the way (or at the door) goes back to "ready" by
   * the system, which also alerts the branch chat.
   */
  async takeOffAll(courierId: string, staffUserId: string): Promise<number> {
    const orders = await this.prisma.customer_order.findMany({
      where: {
        courier_id: courierId,
        status: { in: [...COURIER_HELD_STATUSES] },
      },
      select: { id: true, organization_id: true, status: true },
    });
    for (const o of orders) {
      try {
        if (COURIER_LOCKED_STATUSES.includes(o.status as OrderStatusName)) {
          await this.transitions.transition({
            orderId: o.id,
            to: 'ready',
            actor: 'system',
            actorId: staffUserId,
            note: `courier_disabled:${courierId}`,
          });
        } else {
          await this.unassign(o.organization_id, o.id, staffUserId);
        }
      } catch (e) {
        // The order moved meanwhile (delivered, cancelled): nothing to take off
        if (
          !(e instanceof InvalidTransitionError) &&
          !(e instanceof AppException)
        )
          this.logger.error(
            `Taking order ${o.id} off a disabled courier failed: ${errorMessage(e)}`,
          );
      }
    }
    return orders.length;
  }

  private async loadOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderId: string,
  ) {
    const order = await tx.customer_order.findFirst({
      where: { id: orderId, organization_id: organizationId },
      select: {
        id: true,
        status: true,
        fulfillment: true,
        courier_id: true,
        version: true,
        branch_id: true,
        customer_id: true,
      },
    });
    if (!order) throw new AppException('order_not_found');
    const status = order.status as OrderStatusName;
    if (order.fulfillment !== 'delivery')
      throw new AppException('order_status_conflict', { details: { status } });
    if (COURIER_LOCKED_STATUSES.includes(status))
      throw new AppException('order_courier_locked');
    if (!ASSIGNABLE.includes(status))
      throw new AppException('order_status_conflict', { details: { status } });
    return order;
  }

  /** After the commit: the board and the guest see the courier, the couriers list sees the load (docs/API.md, "События (SSE)"). */
  private async published(
    organizationId: string,
    order: {
      id: string;
      status: string;
      branch_id: string | null;
      customer_id: string | null;
    },
    version: number,
  ) {
    await this.live?.order({
      ...order,
      organization_id: organizationId,
      version,
    });
    await this.live?.publish(organizationId, {
      type: 'courier.changed',
      data: {},
      to: ['staff'],
    });
  }

  /** Optimistic locking: the row must still be at the version read in this transaction. */
  private async update(
    tx: Prisma.TransactionClient,
    order: { id: string; version: number },
    data: Prisma.customer_orderUncheckedUpdateManyInput,
  ) {
    const updated = await tx.customer_order.updateMany({
      where: { id: order.id, version: order.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count === 0) throw new Conflict();
  }

  /** A concurrent change (the courier pressed "picked up", another operator): read again and decide anew. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Conflict && attempt < 3) continue;
        if (e instanceof Conflict)
          throw new AppException('order_status_conflict');
        throw e;
      }
    }
  }
}
