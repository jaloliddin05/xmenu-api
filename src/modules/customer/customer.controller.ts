import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CustomerService } from './services/customer.service';
import { UpdateCustomerDto } from './dto';
import { CurrentCustomer, CustomerProtectedRoute } from '../auth/decorators/customer-route.decorator';
import type { CustomerPrincipal } from '../auth/decorators/customer-route.decorator';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Tenant-Id', description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug', required: true })
@CustomerProtectedRoute()
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current customer' })
  getMe(@CurrentCustomer() me: CustomerPrincipal) {
    return this.customerService.getMe(me.tenantId, me.customerId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current customer name' })
  updateMe(@CurrentCustomer() me: CustomerPrincipal, @Body() dto: UpdateCustomerDto) {
    return this.customerService.updateMe(me.tenantId, me.customerId, dto);
  }
}
