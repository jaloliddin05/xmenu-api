import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  OrderSettingsViewDto,
  UpdateOrderSettingsDto,
} from '../dto/order-settings.dto';
import { OrderSettingsService } from '../services/order-settings.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { deliveryPaymentProblems } from '../domain/delivery-payment';
import { lockDeliveryPayment } from '../services/delivery-payment-state';

/**
 * Restoran paneli: minimal summa (olib ketish), yetkazib berish narxini yaxlitlash qadami, kim yetkazadi,
 * taymautlar. Delivery prices and minimums are per branch: /branch/:id/delivery-pricing.
 */
@ApiTags('Order settings')
@Controller('order-settings')
export class OrderSettingsController {
  constructor(
    private readonly settings: OrderSettingsService,
    private readonly prisma: PrismaService,
    private readonly revalidate: RevalidateService,
  ) {}

  @StaffAccess('venue')
  @Get()
  @ApiOperation({
    summary: 'Current ordering settings (the row is created at signup)',
  })
  @ApiOkResponse({ type: OrderSettingsViewDto })
  get(@Req() req: StaffRequest) {
    return this.settings.get(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Put()
  @ApiOperation({
    summary: "Sozlamalarni saqlash (faqat yuborilgan maydonlar o'zgaradi)",
  })
  @ApiOkResponse({ type: OrderSettingsViewDto })
  async update(@Req() req: StaffRequest, @Body() dto: UpdateOrderSettingsDto) {
    const organizationId = requireStaffOrganizationId(req);
    const data = {
      min_order_pickup: dto.minOrderPickup,
      delivery_price_step: dto.deliveryPriceStep,
      courier_mode: dto.courierMode,
      ...(dto.deliveryPayment && {
        delivery_pay_cash: dto.deliveryPayment.cash,
        delivery_pay_card: dto.deliveryPayment.card,
        delivery_pay_online: dto.deliveryPayment.online,
      }),
      acceptance_timeout_seconds: dto.acceptanceTimeoutSeconds,
      payment_timeout_seconds: dto.paymentTimeoutSeconds,
      max_active_orders: dto.maxActiveOrders,
      pickup_reminder_minutes: dto.pickupReminderMinutes,
      on_the_way_alert_minutes: dto.onTheWayAlertMinutes,
      door_wait_minutes: dto.doorWaitMinutes,
      track_preparation: dto.trackPreparation,
      // undefined: unchanged; null: no rate
      ...(dto.courierPay !== undefined && {
        courier_pay_per_delivery: dto.courierPay?.perDelivery ?? null,
        courier_pay_included_km: dto.courierPay?.includedKm ?? null,
        courier_pay_per_km: dto.courierPay?.perKm ?? null,
      }),
    };
    await this.prisma.$transaction(async (tx) => {
      // settings_missing instead of a Prisma "not found"
      const current = await lockDeliveryPayment(tx, organizationId);
      if (dto.deliveryPayment || dto.courierMode) {
        const problems = deliveryPaymentProblems(
          {
            courierMode: dto.courierMode ?? current.courierMode,
            deliveryPayment: dto.deliveryPayment ?? current.deliveryPayment,
          },
          current.deliveryPayment,
          current.providers,
        );
        if (problems.length)
          throw fieldErrorsException('invalid_settings', problems);
      }
      await tx.organization_order_settings.update({
        where: { organization_id: organizationId },
        data,
      });
    });
    this.settings.invalidate(organizationId);
    // The pickup minimum and the payment methods at delivery are part of the delivery site's config
    await this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'settings',
    });
    return this.settings.get(organizationId);
  }
}
