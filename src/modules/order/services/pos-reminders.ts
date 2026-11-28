import type { PrismaService } from 'src/modules/_prisma/prisma.service';
import { isPosLive } from 'src/modules/pos/domain/pos-steps';
import { LIVE_STATUSES } from '../domain/order-state-machine';

/**
 * iiko (docs/IIKO.md, "Ошибки и сбои"): unfinished orders the operator has to act on (not sent, a
 * street to pick) and whether the owner has to reconnect iiko; zeros and false without iiko.
 * Part of `reminders` of GET /order and `thresholds` of GET /order/board.
 */
export async function posReminders(
  prisma: Pick<PrismaService, 'pos_order' | 'pos_integration'>,
  organizationId: string,
) {
  const [posFailed, integration] = await Promise.all([
    prisma.pos_order.count({
      where: {
        state: { in: ['failed', 'needs_street'] },
        // A disconnected POS no longer takes these orders: nothing to retry
        integration: { status: { in: ['active', 'needs_reconnect'] } },
        order: {
          organization_id: organizationId,
          status: { in: [...LIVE_STATUSES] },
        },
      },
    }),
    prisma.pos_integration.findUnique({
      where: { organization_id: organizationId },
      select: { status: true, courier_mode: true },
    }),
  ]);
  return {
    posFailed,
    posReconnect: integration?.status === 'needs_reconnect',
    // Courier functions of Xmenu are off: the dashboard hides them (docs/IIKO.md, "Курьеры")
    posCouriers:
      isPosLive(integration?.status) && integration?.courier_mode === 'iiko',
  };
}
