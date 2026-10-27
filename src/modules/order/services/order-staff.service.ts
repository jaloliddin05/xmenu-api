import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { nextRestaurantStatus, OrderStatusName } from '../domain/order-state-machine';
import { InvalidTransitionError, OrderNotFoundError, OrderTransitionService } from './order-transition.service';
import { OrderWithItems, toOrderView } from './order-view';

const INCLUDE = {
  items: { include: { options: true } },
  branch: { select: { id: true, title: true, address: true } },
  customer: { select: { id: true, name: true, phone: true } },
  events: { orderBy: { id: 'asc' } },
} satisfies Prisma.customer_orderInclude;

export type RestaurantAction =
  | { type: 'accept'; eta?: { min: number; max: number } }
  | { type: 'reject'; reason?: string }
  | { type: 'next' }
  | { type: 'set'; status: OrderStatusName };

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
  ) {}

  private toStaffView(order: Prisma.customer_orderGetPayload<{ include: typeof INCLUDE }>) {
    return {
      ...toOrderView(order as unknown as OrderWithItems),
      customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone },
      events: order.events.map((e) => ({
        from: e.from_status,
        to: e.to_status,
        actor: e.actor,
        actorId: e.actor_id,
        note: e.note,
        at: e.created_at.toISOString(),
      })),
    };
  }

  async list(organizationId: string, q: { statuses?: OrderStatusName[]; branchId?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
    const rows = await this.prisma.customer_order.findMany({
      where: {
        organization_id: organizationId,
        ...(q.statuses?.length ? { status: { in: q.statuses } } : {}),
        ...(q.branchId ? { branch_id: q.branchId } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: INCLUDE,
    });
    const page = rows.slice(0, limit);
    return { items: page.map((o) => this.toStaffView(o)), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async get(organizationId: string, id: string) {
    const order = await this.prisma.customer_order.findFirst({ where: { id, organization_id: organizationId }, include: INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    return this.toStaffView(order);
  }

  /** Panel uchun: natijada yangilangan buyurtma. Ruxsat etilmagan o'tish — 409. */
  async act(organizationId: string, id: string, action: RestaurantAction, actorId: string) {
    const result = await this.perform(organizationId, id, action, actorId);
    if (!result.changed && result.conflict) {
      throw new ConflictException(`Order is "${result.status}" — this action is not available`);
    }
    return this.get(organizationId, id);
  }

  /**
   * Telegram tugmasi uchun: takror bosish xato emas (changed=false). `organizationId`
   * berilsa buyurtma o'sha tenantga tegishli bo'lishi shart.
   */
  async perform(organizationId: string | null, id: string, action: RestaurantAction, actorId: string): Promise<ActionResult & { conflict: boolean }> {
    const order = await this.prisma.customer_order.findFirst({
      where: { id, ...(organizationId ? { organization_id: organizationId } : {}) },
      select: { status: true, fulfillment: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const from = order.status as OrderStatusName;
    const to = this.target(action, from, order.fulfillment);
    if (!to) return { changed: false, status: from, conflict: true };

    try {
      await this.transitions.transition({
        orderId: id,
        to,
        actor: 'restaurant',
        actorId,
        reason: action.type === 'reject' ? (action.reason ?? 'declined') : undefined,
        eta: action.type === 'accept' ? action.eta : undefined,
      });
      return { changed: true, status: to, conflict: false };
    } catch (e) {
      if (e instanceof OrderNotFoundError) throw new NotFoundException('Order not found');
      if (e instanceof InvalidTransitionError) {
        // Allaqachon shu holatda — takror bosish; boshqa holatda — haqiqiy konflikt.
        return { changed: false, status: e.from, conflict: e.from !== to };
      }
      throw e;
    }
  }

  private target(action: RestaurantAction, from: OrderStatusName, fulfillment: string): OrderStatusName | null {
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
