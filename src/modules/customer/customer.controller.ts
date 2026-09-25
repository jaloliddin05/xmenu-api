import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CustomerService } from './services/customer.service';
import { UpdateCustomerDto } from './dto';

@ApiTags('Customers')
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get current customer',
  })
  @ApiResponse({
    status: 200,
    description: 'Current customer',
  })
  async getMe(@Req() req: any) {
    return this.customerService.getMe(
      req.user.id,
    );
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update current customer',
  })
  @ApiResponse({
    status: 200,
    description: 'Customer updated successfully',
  })
  async updateMe(
    @Req() req: any,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.updateMe(
      req.user.id,
      dto,
    );
  }
}