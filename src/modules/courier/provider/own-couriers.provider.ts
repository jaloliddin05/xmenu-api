import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';
import type { TenantBot } from 'src/modules/telegram/telegram-bot.service';
import { CourierAssignmentService } from '../services/courier-assignment.service';
import {
  CourierBotService,
  CourierBotUpdate,
} from '../services/courier-bot.service';
import type {
  DeliveryProvider,
  DeliveryProviderStatus,
} from './delivery-provider';

function stageOf(
  status: OrderStatusName,
  hasCourier: boolean,
): DeliveryProviderStatus['stage'] {
  switch (status) {
    case 'on_the_way':
      return 'picked_up';
    case 'problem_at_door':
      return 'at_door';
    case 'completed':
      return 'delivered';
    case 'cancelled':
    case 'returned_to_restaurant':
    case 'handed_to_external':
      return 'closed';
    default:
      return hasCourier ? 'assigned' : 'unassigned';
  }
}

/**
 * The venue's own couriers as a delivery provider: the operator assigns a courier on shift, the courier
 * moves the order with the buttons of the venue bot (CourierBotService).
 */
@Injectable()
export class OwnCouriersProvider implements DeliveryProvider {
  readonly kind = 'own_couriers' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: CourierAssignmentService,
    private readonly bot: CourierBotService,
  ) {}

  /** Own couriers need no call outside: the accepted order waits for the operator to assign a courier. */
  async create(organizationId: string, orderId: string): Promise<void> {
    await this.status(organizationId, orderId);
  }

  /** Free the courier of an order that will not be delivered by them (allowed until "picked up"). */
  async cancel(
    organizationId: string,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    await this.assignments.unassign(organizationId, orderId, actorId);
  }

  async status(
    organizationId: string,
    orderId: string,
  ): Promise<DeliveryProviderStatus> {
    const order = await this.prisma.customer_order.findFirst({
      where: {
        id: orderId,
        organization_id: organizationId,
        fulfillment: 'delivery',
      },
      select: {
        status: true,
        external_service: true,
        courier: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new AppException('order_not_found');
    const status = order.status as OrderStatusName;
    return {
      provider: this.kind,
      stage: stageOf(status, Boolean(order.courier)),
      courier: order.courier,
      externalService: order.external_service,
      orderStatus: status,
    };
  }

  handleUpdate(update: unknown, context: unknown): Promise<boolean> {
    return this.bot.handleUpdate(
      context as TenantBot,
      update as CourierBotUpdate,
    );
  }
}
