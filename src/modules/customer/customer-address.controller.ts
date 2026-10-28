import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentCustomer,
  CustomerProtectedRoute,
} from '../auth/decorators/customer-route.decorator';
import type { CustomerPrincipal } from '../auth/decorators/customer-route.decorator';
import { CreateAddressDto } from './dto';
import {
  AddressView,
  CustomerAddressService,
} from './services/customer-address.service';

/**
 * Faqat joriy mijozning manzillari: tenantId va customerId har doim
 * tokendan (CurrentCustomer) olinadi, URL yoki body'dan emas — boshqa
 * mijozning manzilini so'rab bo'lmaydi.
 */
@ApiTags('Customer addresses')
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Tenant-Id',
  description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
  required: true,
})
@CustomerProtectedRoute()
@Controller('customers/me/addresses')
export class CustomerAddressController {
  constructor(private readonly addressService: CustomerAddressService) {}

  @Get()
  @ApiOperation({
    summary: 'Saqlangan manzillar (asosiy birinchi, keyin yangidan eskiga)',
  })
  list(@CurrentCustomer() me: CustomerPrincipal): Promise<AddressView[]> {
    return this.addressService.list(me.tenantId, me.customerId);
  }

  @Post()
  @ApiOperation({
    summary: "Manzil saqlash. Birinchi manzil avtomatik asosiy bo'ladi",
  })
  create(
    @CurrentCustomer() me: CustomerPrincipal,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressView> {
    return this.addressService.create(me.tenantId, me.customerId, dto);
  }

  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({
    summary: "Manzilni asosiy qilish (allaqachon asosiy bo'lsa ham xato emas)",
  })
  setDefault(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressView> {
    return this.addressService.setDefault(me.tenantId, me.customerId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Manzilni o'chirish. Asosiy o'chirilsa, eng yangisi asosiy bo'ladi",
  })
  async remove(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addressService.remove(me.tenantId, me.customerId, id);
  }
}
