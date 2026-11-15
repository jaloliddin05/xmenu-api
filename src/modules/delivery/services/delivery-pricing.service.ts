import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  DeliveryRules,
  deliveryRulesProblems,
  hasRules,
} from 'src/modules/branch/domain/delivery-pricing';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import {
  DeliveryPricingDto,
  DeliveryPricingViewDto,
} from '../dto/delivery-pricing.dto';
import { NO_RULES, toDeliveryRules } from './delivery-rules.mapper';

const RULES_INCLUDE = {
  delivery_zones: { orderBy: { position: 'asc' } },
  delivery_distance: true,
} as const;

/** Pricing rules of one branch for the owner (GET/PUT /branch/:id/delivery-pricing) and for the other services. */
@Injectable()
export class DeliveryPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidate: RevalidateService,
  ) {}

  async get(
    organizationId: string,
    branchId: string,
  ): Promise<DeliveryPricingViewDto> {
    return toView((await this.ownBranch(organizationId, branchId)).rules);
  }

  /** The owner's branch with its rules; another venue's branch (or no such branch) → 404. */
  async ownBranch(organizationId: string, branchId: string) {
    const b = await this.prisma.branch.findFirst({
      where: { id: branchId, organization_id: organizationId },
      select: { id: true, latitude: true, longitude: true, ...RULES_INCLUDE },
    });
    if (!b)
      throw new AppException('not_found', { message: 'Branch not found' });
    return {
      id: b.id,
      latitude: b.latitude,
      longitude: b.longitude,
      rules: toDeliveryRules(b.delivery_zones, b.delivery_distance),
    };
  }

  /** Replaces the whole pricing of the branch: zones in the given order, the distance rule or none. */
  async replace(
    organizationId: string,
    branchId: string,
    dto: DeliveryPricingDto,
  ): Promise<DeliveryPricingViewDto> {
    const problems = deliveryRulesProblems(dto);
    if (problems.length)
      throw fieldErrorsException('invalid_settings', problems);
    await this.ownBranch(organizationId, branchId);

    const d = dto.distance ?? null;
    await this.prisma.$transaction([
      this.prisma.branch_delivery_zone.deleteMany({
        where: { branch_id: branchId },
      }),
      this.prisma.branch_delivery_zone.createMany({
        data: dto.zones.map((z, position) => ({
          branch_id: branchId,
          position,
          polygon: z.polygon,
          price: z.price,
          min_order: z.minOrder,
          free_from: z.freeFrom ?? null,
        })),
      }),
      this.prisma.branch_delivery_distance.deleteMany({
        where: { branch_id: branchId },
      }),
      ...(d
        ? [
            this.prisma.branch_delivery_distance.create({
              data: {
                branch_id: branchId,
                base_price: d.basePrice,
                included_km: d.includedKm,
                price_per_km: d.pricePerKm,
                max_km: d.maxKm,
                min_order: d.minOrder,
                free_from: d.freeFrom ?? null,
              },
            }),
          ]
        : []),
    ]);
    // Delivery availability and the zones on the map are part of the delivery site's config
    await this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'branches',
    });
    return this.get(organizationId, branchId);
  }

  /** Rules of every active branch of the venue, by branch id (a branch without rows gets NO_RULES). */
  async rulesByBranch(
    organizationId: string,
  ): Promise<Map<string, DeliveryRules>> {
    const rows = await this.prisma.branch.findMany({
      where: { organization_id: organizationId, is_active: true },
      select: { id: true, ...RULES_INCLUDE },
    });
    return new Map(
      rows.map((b) => [
        b.id,
        toDeliveryRules(b.delivery_zones, b.delivery_distance),
      ]),
    );
  }

  /** Active branches that take delivery and have at least one rule (tenant config, publication checklist). */
  async pricedDeliveryBranches(organizationId: string) {
    const rows = await this.prisma.branch.findMany({
      where: {
        organization_id: organizationId,
        is_active: true,
        accepts_delivery: true,
      },
      select: { id: true, ...RULES_INCLUDE },
    });
    return rows
      .map((b) => ({
        id: b.id,
        rules: toDeliveryRules(b.delivery_zones, b.delivery_distance),
      }))
      .filter((b) => hasRules(b.rules));
  }
}

function toView(rules: DeliveryRules = NO_RULES): DeliveryPricingViewDto {
  return {
    zones: rules.zones.map((z) => ({
      polygon: z.polygon,
      price: z.price,
      minOrder: z.minOrder,
      freeFrom: z.freeFrom,
    })),
    distance: rules.distance ? { ...rules.distance } : null,
  };
}
