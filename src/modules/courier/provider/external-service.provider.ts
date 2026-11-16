import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';
import {
  InvalidTransitionError,
  OrderTransitionService,
} from 'src/modules/order/services/order-transition.service';
import type {
  DeliveryProvider,
  DeliveryProviderStatus,
  DeliveryRequest,
} from './delivery-provider';

/**
 * An external service (a taxi, a courier company) chosen by the operator by hand (docs/DELIVERY.md,
 * "Передача внешней службе"). There is no integration: the system records the service and its cost and closes
 * the order at once (handed_to_external). Services with an API (Noor, Yandex, Millennium) become adapters of
 * their own later.
 */
@Injectable()
export class ExternalServiceProvider implements DeliveryProvider {
  readonly kind = 'external_service' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
  ) {}

  async create(
    organizationId: string,
    orderId: string,
    request?: DeliveryRequest,
  ): Promise<void> {
    if (!request?.external)
      throw new Error('An external handover needs the service and its cost');
    const order = await this.prisma.customer_order.findFirst({
      where: { id: orderId, organization_id: organizationId },
      select: { fulfillment: true, status: true },
    });
    if (!order) throw new AppException('order_not_found');
    if (order.fulfillment !== 'delivery')
      throw new AppException('order_status_conflict', {
        details: { status: order.status },
      });
    try {
      await this.transitions.transition({
        orderId,
        to: 'handed_to_external',
        actor: 'restaurant',
        actorId: request.actorId,
        external: request.external,
        note: 'external_service',
      });
    } catch (e) {
      if (e instanceof InvalidTransitionError)
        throw new AppException('order_status_conflict', {
          details: { status: e.from },
        });
      throw e;
    }
  }

  /** A handed-over order is closed: there is nothing to call off. */
  cancel(): Promise<void> {
    return Promise.resolve();
  }

  async status(
    organizationId: string,
    orderId: string,
  ): Promise<DeliveryProviderStatus> {
    const order = await this.prisma.customer_order.findFirst({
      where: { id: orderId, organization_id: organizationId },
      select: { status: true, external_service: true },
    });
    if (!order) throw new AppException('order_not_found');
    return {
      provider: this.kind,
      stage: order.status === 'handed_to_external' ? 'closed' : 'unassigned',
      courier: null,
      externalService: order.external_service,
      orderStatus: order.status as OrderStatusName,
    };
  }

  /** No updates come from an external service without an integration. */
  handleUpdate(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
