import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { LiveEventBus } from './live-event-bus';

/**
 * `order.changed` for an order known only by id, after a change that does not go through OrderTransitionService
 * (the POS state of an order: sent, failed, waiting for a street, entered by hand; the courier name from iiko).
 */
@Injectable()
export class LiveOrderNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: LiveEventBus,
  ) {}

  async changed(orderId: string | null | undefined): Promise<void> {
    if (!orderId) return;
    const order = await this.prisma.customer_order
      .findUnique({
        where: { id: orderId },
        select: {
          id: true,
          organization_id: true,
          branch_id: true,
          customer_id: true,
          status: true,
          version: true,
        },
      })
      .catch(() => null);
    if (order) await this.bus.order(order);
  }
}
