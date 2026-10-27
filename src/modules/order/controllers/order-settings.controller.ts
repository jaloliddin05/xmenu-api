import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { parseZone } from '../domain/order-money';
import { UpdateOrderSettingsDto } from '../dto/order-settings.dto';
import { OrderSettingsService } from '../services/order-settings.service';

/** Restoran paneli: yetkazib berish narxi, minimal summa, zona, taymautlar. */
@ApiTags('Order settings')
@Controller('order-settings')
export class OrderSettingsController {
  constructor(
    private readonly settings: OrderSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Joriy sozlamalar (qator bo\'lmasa standartlar)' })
  get(@Req() req) {
    return this.settings.get(requireStaffOrganizationId(req));
  }

  @Put()
  @ApiOperation({ summary: "Sozlamalarni saqlash (faqat yuborilgan maydonlar o'zgaradi)" })
  async update(@Req() req, @Body() dto: UpdateOrderSettingsDto) {
    const organizationId = requireStaffOrganizationId(req);

    if (dto.deliveryZone != null && parseZone(dto.deliveryZone) === null) {
      throw new BadRequestException('deliveryZone must be [[lat, lng], ...] with at least 3 points');
    }
    if (dto.etaMin != null && dto.etaMax != null && dto.etaMax < dto.etaMin) {
      throw new BadRequestException('etaMax must be >= etaMin');
    }

    // deliveryZone: undefined — o'zgartirmaslik; null — zonani o'chirish (SQL NULL); massiv — saqlash
    const zone = dto.deliveryZone === null ? Prisma.DbNull : (dto.deliveryZone ?? undefined);
    const data = {
      delivery_service_fee: dto.deliveryServiceFee,
      min_order_delivery: dto.minOrderDelivery,
      min_order_pickup: dto.minOrderPickup,
      eta_min: dto.etaMin,
      eta_max: dto.etaMax,
      acceptance_timeout_seconds: dto.acceptanceTimeoutSeconds,
      payment_timeout_seconds: dto.paymentTimeoutSeconds,
      max_active_orders: dto.maxActiveOrders,
      delivery_zone: zone,
    };
    await this.prisma.organization_order_settings.upsert({
      where: { organization_id: organizationId },
      create: { organization_id: organizationId, ...data },
      update: data,
    });
    this.settings.invalidate(organizationId);
    return this.settings.get(organizationId);
  }
}
