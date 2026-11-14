import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  DeliveryPrice,
  distanceKm,
  LatLng,
  priceDelivery,
  rateFor,
} from 'src/modules/branch/domain/delivery-pricing';
import { BranchService } from 'src/modules/branch/services/branch.service';
import { chooseDeliveryBranch } from 'src/modules/order/domain/branch-choice';
import { OrderSettingsService } from 'src/modules/order/services/order-settings.service';
import { orderingProblem } from 'src/modules/organization/domain/publication';
import {
  DeliveryPriceCheckDto,
  DeliveryQuoteDto,
  QUOTE_REASONS,
  QuoteReason,
} from '../dto/delivery-pricing.dto';
import { DeliveryPricingService } from './delivery-pricing.service';
import { NO_RULES } from './delivery-rules.mapper';

export interface DeliveryChoiceResult {
  branch: { id: string; title: string; address: string };
  price: DeliveryPrice;
}

const km = (value: number) => Math.round(value * 100) / 100;

/**
 * The delivery branch and price for an address: one path for the cart quote (GET /delivery/quote) and
 * POST /orders, so the guest sees the price the order is placed with.
 */
@Injectable()
export class DeliveryQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchService,
    private readonly settings: OrderSettingsService,
    private readonly pricing: DeliveryPricingService,
  ) {}

  /**
   * Branch and price for an order; throws the reason (branch-choice.ts) when no branch can deliver now. The
   * minimum is not checked here: shortBy tells the caller.
   */
  async choose(
    organizationId: string,
    address: LatLng | null,
    subtotal: number,
  ): Promise<DeliveryChoiceResult> {
    const [all, rules, settings] = await Promise.all([
      this.branches.listActiveWithState(organizationId),
      this.pricing.rulesByBranch(organizationId),
      this.settings.get(organizationId),
    ]);
    const { candidate, rate } = chooseDeliveryBranch(
      all.map((c) => ({ ...c, rules: rules.get(c.branch.id) ?? NO_RULES })),
      address,
    );
    const { id, title, address: branchAddress } = candidate.branch;
    return {
      branch: { id, title, address: branchAddress },
      price: priceDelivery(
        candidate.rules,
        rate,
        subtotal,
        settings.deliveryPriceStep,
      ),
    };
  }

  /** GET /delivery/quote: never throws for a reason the guest should see, it is returned as `reason`. */
  async quote(
    organizationId: string,
    address: LatLng,
    subtotal: number,
  ): Promise<DeliveryQuoteDto> {
    // Read fresh like POST /orders: a paused channel shows at once
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { delivery_enabled: true, published_at: true },
    });
    if (!org) throw new AppException('tenant_not_found');
    const problem = orderingProblem({
      deliveryEnabled: org.delivery_enabled,
      publishedAt: org.published_at,
    });
    if (problem) return unavailable(problem);

    let choice: DeliveryChoiceResult;
    try {
      choice = await this.choose(organizationId, address, subtotal);
    } catch (e) {
      if (e instanceof AppException && isQuoteReason(e.code)) {
        const opensAt = e.details?.opensAt;
        return unavailable(
          e.code,
          typeof opensAt === 'string' ? opensAt : null,
        );
      }
      throw e;
    }
    const { branch, price } = choice;
    const enough = price.shortBy === 0;
    return {
      available: true,
      canOrder: enough,
      reason: enough ? null : 'min_order_not_reached',
      opensAt: null,
      branch,
      rule: price.rule,
      distanceKm: km(price.distanceKm),
      deliveryFee: price.deliveryFee,
      freeFrom: price.freeFrom,
      minOrder: price.minOrder,
      shortBy: price.shortBy,
    };
  }

  /** GET /branch/:id/delivery-pricing/check: the saved rules of one branch, hours and publication aside. */
  async check(
    organizationId: string,
    branchId: string,
    address: LatLng,
    subtotal: number,
  ): Promise<DeliveryPriceCheckDto> {
    const [branch, settings] = await Promise.all([
      this.pricing.ownBranch(organizationId, branchId),
      this.settings.get(organizationId),
    ]);
    const from: LatLng = [branch.latitude, branch.longitude];
    const rate = rateFor(branch.rules, from, address);
    if (!rate) {
      return {
        covered: false,
        rule: null,
        zoneIndex: null,
        distanceKm: km(distanceKm(from, address)),
        deliveryFee: null,
        freeFrom: null,
        minOrder: null,
        shortBy: 0,
      };
    }
    const price = priceDelivery(
      branch.rules,
      rate,
      subtotal,
      settings.deliveryPriceStep,
    );
    return {
      covered: true,
      rule: price.rule,
      zoneIndex: price.zoneIndex,
      distanceKm: km(price.distanceKm),
      deliveryFee: price.deliveryFee,
      freeFrom: price.freeFrom,
      minOrder: price.minOrder,
      shortBy: price.shortBy,
    };
  }
}

const isQuoteReason = (code: string): code is QuoteReason =>
  (QUOTE_REASONS as readonly string[]).includes(code);

function unavailable(
  reason: QuoteReason,
  opensAt: string | null = null,
): DeliveryQuoteDto {
  return {
    available: false,
    canOrder: false,
    reason,
    opensAt,
    branch: null,
    rule: null,
    distanceKm: null,
    deliveryFee: null,
    freeFrom: null,
    minOrder: null,
    shortBy: 0,
  };
}
