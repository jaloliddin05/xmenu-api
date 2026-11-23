import { Injectable } from '@nestjs/common';
import type { delivery_area, delivery_area_part, Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import type { DefaultRule } from 'src/modules/branch/domain/delivery-pricing';
import {
  areaPartsProblems,
  customRing,
  DeliveryArea,
  parseRings,
  PUBLIC_DIGITS,
} from '../domain/delivery-area';
import { Ring, roundRing } from '../domain/geometry';
import {
  DeliveryAreaDto,
  DeliveryAreaViewDto,
  PublicDeliveryAreaDto,
} from '../dto/delivery-area.dto';
import { RegionCatalog } from '../regions/region-catalog';

const PARTS_ORDER = { orderBy: { position: 'asc' } } as const;

/**
 * The venue delivery area (docs/DELIVERY.md, "Общая зона доставки заведения"): the owner's GET/PUT, the area
 * for the price choice (DeliveryQuoteService) and the guest map (GET /delivery/area).
 */
@Injectable()
export class DeliveryAreaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: RegionCatalog,
  ) {}

  async get(organizationId: string): Promise<DeliveryAreaViewDto> {
    const [area, parts] = await this.rows(organizationId);
    return {
      parts: parts.flatMap((p) => {
        const rings = parseRings(p.geometry);
        if (!rings) return [];
        const region = p.region_code ? this.catalog.find(p.region_code) : null;
        return [
          {
            source: p.source,
            code: p.region_code,
            name: region ? { ...region.name } : null,
            catalogVersion: p.catalog_version,
            rings,
          },
        ];
      }),
      defaultRule: area ? toDefaultRule(area) : null,
    };
  }

  /**
   * Replaces the area as a whole: region parts get a copy of the catalog geometry and its version, drawn parts
   * their rounded outline. No parts: no area and no default rule. Under a lock of the venue row, so two saves
   * do not mix their parts.
   */
  async replace(
    organizationId: string,
    dto: DeliveryAreaDto,
  ): Promise<DeliveryAreaViewDto> {
    const problems = areaPartsProblems(dto.parts, this.catalog.has);
    const rule = dto.defaultRule ?? null;
    if (dto.parts.length > 0 && !rule)
      problems.push({
        field: 'defaultRule',
        code: 'required',
        message: 'The default price is required with an area',
      });
    if (problems.length)
      throw fieldErrorsException('invalid_settings', problems);

    const data = dto.parts.map((part, position) => {
      if (part.source === 'region') {
        const region = this.catalog.find(part.code!)!;
        return {
          organization_id: organizationId,
          position,
          source: 'region' as const,
          region_code: region.code,
          catalog_version: this.catalog.version,
          geometry: region.rings,
        };
      }
      return {
        organization_id: organizationId,
        position,
        source: 'custom' as const,
        region_code: null,
        catalog_version: null,
        geometry: [customRing(part.polygon)!],
      };
    });

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
      if (locked.length === 0)
        throw new AppException('not_found', { message: 'Venue not found' });
      await tx.delivery_area_part.deleteMany({
        where: { organization_id: organizationId },
      });
      await tx.delivery_area.deleteMany({
        where: { organization_id: organizationId },
      });
      if (data.length === 0 || !rule) return;
      await tx.delivery_area_part.createMany({ data });
      await tx.delivery_area.create({
        data: {
          organization_id: organizationId,
          base_price: rule.basePrice,
          included_km: rule.includedKm,
          price_per_km: rule.pricePerKm,
          min_order: rule.minOrder,
          free_from: rule.freeFrom ?? null,
        },
      });
    });
    return this.get(organizationId);
  }

  /** The area for the price choice; null when the venue has none (or every stored part is broken). */
  async forPricing(organizationId: string): Promise<DeliveryArea | null> {
    const [area, parts] = await this.rows(organizationId);
    const rings = parts.flatMap((p) => {
      const parsed = parseRings(p.geometry);
      return parsed ? [parsed] : [];
    });
    if (!area || rings.length === 0) return null;
    return { parts: rings, defaultRule: toDefaultRule(area) };
  }

  /** The area is set (deliveryAreaIsSet): tenant config. */
  isSet(organizationId: string): Promise<boolean> {
    return deliveryAreaIsSet(this.prisma, organizationId);
  }

  /** GET /delivery/area: the parts the guest map draws, 5 decimals; null without an area. */
  async forGuest(organizationId: string): Promise<PublicDeliveryAreaDto> {
    const area = await this.forPricing(organizationId);
    return {
      parts: area
        ? area.parts.map((rings: Ring[]) =>
            rings.map((ring) => roundRing(ring, PUBLIC_DIGITS)),
          )
        : null,
    };
  }

  private rows(
    organizationId: string,
  ): Promise<[delivery_area | null, delivery_area_part[]]> {
    return Promise.all([
      this.prisma.delivery_area.findUnique({
        where: { organization_id: organizationId },
      }),
      this.prisma.delivery_area_part.findMany({
        where: { organization_id: organizationId },
        ...PARTS_ORDER,
      }),
    ]);
  }
}

/**
 * The venue has a delivery area: at least one part and the default rule. Takes the client or a transaction
 * (the publication checklist reads in its own).
 */
export async function deliveryAreaIsSet(
  db: Pick<Prisma.TransactionClient, 'delivery_area_part'>,
  organizationId: string,
): Promise<boolean> {
  const parts = await db.delivery_area_part.count({
    where: {
      organization_id: organizationId,
      organization: { delivery_area: { isNot: null } },
    },
  });
  return parts > 0;
}

const toDefaultRule = (a: delivery_area): DefaultRule => ({
  basePrice: a.base_price,
  includedKm: a.included_km,
  pricePerKm: a.price_per_km,
  minOrder: a.min_order,
  freeFrom: a.free_from,
});
