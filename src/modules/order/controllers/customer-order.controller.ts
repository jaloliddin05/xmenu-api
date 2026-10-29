import { Body, Controller, Get, Header, HttpCode, HttpStatus, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveLang } from 'src/infra/http/request-helpers';
import { CurrentCustomer, CustomerProtectedRoute } from 'src/modules/auth/decorators/customer-route.decorator';
import type { CustomerPrincipal } from 'src/modules/auth/decorators/customer-route.decorator';
import { CurrentTenant } from 'src/modules/tenant/current-tenant.decorator';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderService } from '../services/order.service';

/**
 * Mijoz buyurtmalari. Mijoz va tenant doim tokendan (CurrentCustomer) olinadi;
 * boshqa mijoz buyurtmasi "order_not_found" qaytaradi. Kontrakt: docs/ORDERS_API.md.
 */
@ApiTags('Orders (customer)')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Tenant-Id', description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug', required: true })
@CustomerProtectedRoute()
@Controller('orders')
export class CustomerOrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'Idempotency-Key', description: 'Har bir buyurtma urinishi uchun noyob kalit (8-128 belgi). Takrorda o\'sha buyurtma qaytadi.', required: true })
  @ApiOperation({ summary: 'Buyurtma yaratish' })
  create(
    @CurrentCustomer() principal: CustomerPrincipal,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.create(principal, dto, key, resolveLang(req), tenant.currency);
  }

  @Get()
  @ApiOperation({ summary: "Mijoz buyurtmalari (yangilari birinchi, 50 tagacha). ?status=active — tugallanmaganlari" })
  list(@CurrentCustomer() principal: CustomerPrincipal, @Query('status') status: string | undefined, @Req() req: Request) {
    return this.orders.list(principal, { activeOnly: status === 'active' }, resolveLang(req));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Bitta buyurtma (ekran shuni so\'rab turadi)' })
  get(@CurrentCustomer() principal: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.orders.get(principal, id, resolveLang(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bekor qilish (faqat tayyorlash boshlanguncha)' })
  cancel(@CurrentCustomer() principal: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.orders.cancel(principal, id, resolveLang(req));
  }

  @Post(':id/payment/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "To'lov muvaffaqiyatsiz bo'lgan buyurtma uchun yangi to'lov havolasi" })
  retryPayment(@CurrentCustomer() principal: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.orders.retryPayment(principal, id, resolveLang(req));
  }
}
