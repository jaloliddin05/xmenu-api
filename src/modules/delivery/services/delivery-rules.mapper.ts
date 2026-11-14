import type {
  branch_delivery_distance,
  branch_delivery_zone,
} from '@prisma/client';
import {
  DeliveryRules,
  parseZone,
} from 'src/modules/branch/domain/delivery-pricing';

export const NO_RULES: DeliveryRules = { zones: [], distance: null };

/** Stored rows of one branch → rules. Zones in position order; a zone with a broken polygon is skipped. */
export function toDeliveryRules(
  zones: Pick<
    branch_delivery_zone,
    'position' | 'polygon' | 'price' | 'min_order' | 'free_from'
  >[],
  distance: Omit<branch_delivery_distance, 'branch_id'> | null,
): DeliveryRules {
  return {
    zones: [...zones]
      .sort((a, b) => a.position - b.position)
      .flatMap((z) => {
        const polygon = parseZone(z.polygon);
        return polygon
          ? [
              {
                polygon,
                price: z.price,
                minOrder: z.min_order,
                freeFrom: z.free_from,
              },
            ]
          : [];
      }),
    distance: distance
      ? {
          basePrice: distance.base_price,
          includedKm: distance.included_km,
          pricePerKm: distance.price_per_km,
          maxKm: distance.max_km,
          minOrder: distance.min_order,
          freeFrom: distance.free_from,
        }
      : null,
  };
}
