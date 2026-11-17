import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { PosOrderViewDto } from 'src/modules/order/dto/order-view.dto';
import {
  PosManualDto,
  PosStreetDto,
  PosStreetsDto,
} from '../dto/pos-order.dto';
import { PosOrderService } from '../services/pos-order.service';

/**
 * What the operator does with an order that did not get into iiko (docs/API.md, "Передача заказа
 * в iiko"). An order without iiko answers 404 pos_not_connected.
 */
@ApiTags('POS (iiko)')
@Controller('order/:id/pos')
export class PosOrderController {
  constructor(private readonly orders: PosOrderService) {}

  @StaffAccess('orders')
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '«Повторить»: a new round of attempts for an order not sent to iiko',
  })
  @ApiOkResponse({ type: PosOrderViewDto })
  retry(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.retry(requireStaffOrganizationId(req), id, req.user.id);
  }

  @StaffAccess('orders')
  @Post('manual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Внесён вручную»: the operator entered the order into iiko',
  })
  @ApiOkResponse({ type: PosOrderViewDto })
  manual(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PosManualDto,
  ) {
    return this.orders.manual(
      requireStaffOrganizationId(req),
      id,
      dto.posNumber?.trim() || null,
      req.user.id,
    );
  }

  @StaffAccess('orders')
  @Get('streets')
  @ApiOperation({
    summary: 'Streets of the iiko directory for an order waiting for a street',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Part of the name' })
  @ApiOkResponse({ type: PosStreetsDto })
  async streets(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') q?: string,
  ) {
    const items = await this.orders.streets(
      requireStaffOrganizationId(req),
      id,
      (q ?? '').slice(0, 100),
    );
    return { items };
  }

  @StaffAccess('orders')
  @Put('street')
  @ApiOperation({
    summary: 'The street and house for iiko; the order is sent again',
  })
  @ApiOkResponse({ type: PosOrderViewDto })
  setStreet(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PosStreetDto,
  ) {
    return this.orders.setStreet(
      requireStaffOrganizationId(req),
      id,
      { streetId: dto.streetId.trim(), house: dto.house.trim() },
      req.user.id,
    );
  }
}
