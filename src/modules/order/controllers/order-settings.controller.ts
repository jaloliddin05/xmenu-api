import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { UpdateOrderSettingsDto } from '../dto/order-settings.dto';
import { OrderSettingsService } from '../services/order-settings.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';

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

  @Get()
  @ApiOperation({
    summary: 'Current ordering settings (the row is created at signup)',
  })
  get(@Req() req: StaffRequest) {
    return this.settings.get(requireStaffOrganizationId(req));
  }

  @Put()
  @ApiOperation({
    summary: "Sozlamalarni saqlash (faqat yuborilgan maydonlar o'zgaradi)",
  })
  async update(@Req() req: StaffRequest, @Body() dto: UpdateOrderSettingsDto) {
    const organizationId = requireStaffOrganizationId(req);
    const data = {
      min_order_pickup: dto.minOrderPickup,
      delivery_price_step: dto.deliveryPriceStep,
      courier_mode: dto.courierMode,
      acceptance_timeout_seconds: dto.acceptanceTimeoutSeconds,
      payment_timeout_seconds: dto.paymentTimeoutSeconds,
      max_active_orders: dto.maxActiveOrders,
    };
    await this.settings.get(organizationId); // settings_missing instead of a Prisma "not found"
    await this.prisma.organization_order_settings.update({
      where: { organization_id: organizationId },
      data,
    });
    this.settings.invalidate(organizationId);
    // The pickup minimum and cash on delivery (courier mode) are part of the delivery site's config
    await this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'settings',
    });
    return this.settings.get(organizationId);
  }
}
