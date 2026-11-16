import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';

const SUGGESTIONS = 20;

/**
 * Around the external handover (ExternalServiceProvider does the handover itself): the service names used
 * before, and the operator's later mark whether the venue got the cash of a handed-over cash order.
 */
@Injectable()
export class ExternalDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
  ) {}

  /** Names of services the venue used, the most recent first. */
  async suggestions(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.customer_order.groupBy({
      by: ['external_service'],
      where: {
        organization_id: organizationId,
        external_service: { not: null },
      },
      _max: { external_handed_at: true },
      orderBy: { _max: { external_handed_at: 'desc' } },
      take: SUGGESTIONS,
    });
    return rows.map((r) => r.external_service!);
  }

  /** Once per handed-over cash order: did the venue get the money? Written to the order journal. */
  async markPayment(
    organizationId: string,
    orderId: string,
    received: boolean,
    staffUserId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer_order.updateMany({
        where: {
          id: orderId,
          organization_id: organizationId,
          status: 'handed_to_external',
          payment_method: 'cash',
          external_cash_received: null,
        },
        data: { external_cash_received: received },
      });
      if (updated.count === 0) {
        const exists = await tx.customer_order.count({
          where: { id: orderId, organization_id: organizationId },
        });
        throw new AppException(
          exists ? 'external_payment_not_pending' : 'order_not_found',
        );
      }
      await this.transitions.recordInTx(tx, {
        orderId,
        status: 'handed_to_external',
        actor: 'restaurant',
        actorId: staffUserId,
        note: received
          ? 'external_cash_received'
          : 'external_cash_not_received',
      });
    });
  }
}
