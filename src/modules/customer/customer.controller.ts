import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CustomerService } from './services/customer.service';
import { CustomerAnonymizerService } from './services/customer-anonymizer.service';
import { UpdateCustomerDto } from './dto';
import {
  CurrentCustomer,
  CustomerProtectedRoute,
} from '../auth/decorators/customer-route.decorator';
import type { CustomerPrincipal } from '../auth/decorators/customer-route.decorator';

import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { Tenant } from '../tenant/tenant.service';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Tenant-Id',
  description:
    'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
  required: true,
})
@CustomerProtectedRoute()
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly anonymizer: CustomerAnonymizerService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current customer' })
  getMe(@CurrentCustomer() me: CustomerPrincipal) {
    return this.customerService.getMe(me.tenantId, me.customerId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update current customer name and/or preferred language',
  })
  updateMe(
    @CurrentCustomer() me: CustomerPrincipal,
    @CurrentTenant() tenant: Tenant,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.updateMe(
      me.tenantId,
      me.customerId,
      dto,
      tenant.languages,
    );
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete the guest account (anonymization)',
    description:
      'Removes the phone, name, Telegram id, addresses and sessions and anonymizes the guest data in past orders (sums, items, statuses and dates stay). Signing in with the same phone later creates a new guest.',
  })
  @ApiResponse({ status: 204, description: 'Account deleted' })
  @ApiResponse({
    status: 409,
    description: 'has_active_orders: the guest has unfinished orders',
  })
  async deleteMe(@CurrentCustomer() me: CustomerPrincipal): Promise<void> {
    await this.anonymizer.deleteGuest(me.tenantId, me.customerId);
  }
}
