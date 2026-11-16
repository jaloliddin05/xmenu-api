import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import type { DeliveryPaymentState } from '../domain/delivery-payment';

type Db = Prisma.TransactionClient;

/** Who delivers, the switches and the enabled providers, read fresh from the database (not the settings cache) */
export async function readDeliveryPayment(
  db: Db,
  organizationId: string,
): Promise<DeliveryPaymentState & { providers: Set<string> }> {
  const [row, providers] = await Promise.all([
    db.organization_order_settings.findUnique({
      where: { organization_id: organizationId },
      select: {
        courier_mode: true,
        delivery_pay_cash: true,
        delivery_pay_card: true,
        delivery_pay_online: true,
      },
    }),
    db.organization_payment_provider.findMany({
      where: { organization_id: organizationId, is_enabled: true },
      select: { provider: true },
    }),
  ]);
  // The row is created at signup; a missing one is a data bug
  if (!row)
    throw new AppException('settings_missing', {
      message: 'Venue settings are missing',
    });
  return {
    courierMode: row.courier_mode,
    deliveryPayment: {
      cash: row.delivery_pay_cash,
      card: row.delivery_pay_card,
      online: row.delivery_pay_online,
    },
    providers: new Set(providers.map((p) => p.provider)),
  };
}

/**
 * The same, with the venue row locked to the end of the transaction (the lock publication takes too):
 * saving the switches or the courier mode and disabling a provider run one at a time, so two of them at
 * once cannot leave delivery without a payment method.
 */
export async function lockDeliveryPayment(db: Db, organizationId: string) {
  await db.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  return readDeliveryPayment(db, organizationId);
}
