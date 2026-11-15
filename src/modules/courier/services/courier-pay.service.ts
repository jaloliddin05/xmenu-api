import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderSettingsService } from 'src/modules/order/services/order-settings.service';
import { PayRate, payRateOf } from '../domain/courier-pay';

export interface CourierPayRates {
  venue: PayRate | null;
  couriers: {
    courierId: string;
    name: string;
    isActive: boolean;
    rate: PayRate | null;
  }[];
}

/**
 * Courier pay rates (owner only: the operator sees no money). The venue rate lives in the order settings;
 * a courier's own rate replaces it as a whole. Accrued pay is fixed in the order at delivery, so a change here
 * affects later deliveries only.
 */
@Injectable()
export class CourierPayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrderSettingsService,
  ) {}

  async rates(organizationId: string): Promise<CourierPayRates> {
    const [settings, couriers] = await Promise.all([
      this.settings.get(organizationId),
      this.prisma.courier.findMany({
        where: { organization_id: organizationId },
        orderBy: [{ is_active: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true,
          name: true,
          is_active: true,
          pay_per_delivery: true,
          pay_included_km: true,
          pay_per_km: true,
        },
      }),
    ]);
    return {
      venue: settings.courierPay,
      couriers: couriers.map((c) => ({
        courierId: c.id,
        name: c.name,
        isActive: c.is_active,
        rate: payRateOf({
          perDelivery: c.pay_per_delivery,
          includedKm: c.pay_included_km,
          perKm: c.pay_per_km,
        }),
      })),
    };
  }

  async setRate(
    organizationId: string,
    courierId: string,
    rate: PayRate | null,
  ): Promise<CourierPayRates> {
    const updated = await this.prisma.courier.updateMany({
      where: { id: courierId, organization_id: organizationId },
      data: {
        pay_per_delivery: rate?.perDelivery ?? null,
        pay_included_km: rate?.includedKm ?? null,
        pay_per_km: rate?.perKm ?? null,
      },
    });
    if (updated.count === 0)
      throw new AppException('not_found', { message: 'Courier not found' });
    return this.rates(organizationId);
  }
}
