import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { StaffOrderListDto, StaffOrderViewDto } from '../dto/order-view.dto';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { ORDER_STATUSES, OrderStatusName } from '../domain/order-state-machine';
import { POS_ORDER_STATES } from '../services/order-view';
import {
  ExpectedStatusDto,
  RejectOrderDto,
  SetOrderStatusDto,
} from '../dto/staff-order.dto';
import { OrderBoardDto } from '../dto/order-board.dto';
import { OrderBoardService } from '../services/order-board.service';
import { OrderStaffService } from '../services/order-staff.service';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';

/** Restoran paneli: kelgan buyurtmalar va ularni boshqarish. Tenant — tokendagi organization. */
@ApiTags('Orders (staff)')
@Controller('order')
export class StaffOrderController {
  constructor(
    private readonly staff: OrderStaffService,
    private readonly boards: OrderBoardService,
  ) {}

  @StaffAccess('orders')
  @Get()
  @ApiOperation({
    summary: "Buyurtmalar ro'yxati (yangilari birinchi, cursor pagination)",
  })
  @ApiOkResponse({ type: StaffOrderListDto })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Vergul bilan: pending_acceptance,accepted',
  })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'courierId', required: false })
  @ApiQuery({
    name: 'unassigned',
    required: false,
    description: 'true: delivery orders accepted or ready without a courier',
  })
  @ApiQuery({
    name: 'posState',
    required: false,
    description:
      'Comma-separated states of the transfer to iiko: failed,needs_street (docs/API.md, "Передача заказа в iiko")',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @Req() req: StaffRequest,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('courierId') courierId?: string,
    @Query('unassigned') unassigned?: string,
    @Query('posState') posState?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const statuses = (status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatusName =>
        (ORDER_STATUSES as readonly string[]).includes(s),
      );
    return this.staff.list(requireStaffOrganizationId(req), {
      statuses,
      branchId,
      courierId,
      unassigned: unassigned === 'true',
      posStates: (posState ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => (POS_ORDER_STATES as readonly string[]).includes(s)),
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Declared before :id, whose ParseUUIDPipe would refuse "board"
  @StaffAccess('orders')
  @Get('board')
  @ApiOperation({
    summary:
      'Order board: every live order of the venue or a branch, light (no guest name, phone or history), with attention codes, the acceptance deadline and today totals',
  })
  @ApiOkResponse({ type: OrderBoardDto })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description:
      'One branch (another venue’s branch: 404); all branches without it',
  })
  board(
    @Req() req: StaffRequest,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.boards.board(requireStaffOrganizationId(req), branchId);
  }

  @StaffAccess('orders')
  @Get(':id')
  @ApiOperation({ summary: 'Buyurtma tafsiloti (mijoz, status tarixi bilan)' })
  @ApiOkResponse({ type: StaffOrderViewDto })
  get(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(requireStaffOrganizationId(req), id);
  }

  @StaffAccess('orders')
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Qabul qilish' })
  @ApiOkResponse({ type: StaffOrderViewDto })
  accept(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpectedStatusDto,
  ) {
    return this.staff.act(
      requireStaffOrganizationId(req),
      id,
      { type: 'accept' },
      req.user.id,
      dto.expectedStatus,
    );
  }

  @StaffAccess('orders')
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rad etish (to'langan bo'lsa pul qaytariladi)" })
  @ApiOkResponse({ type: StaffOrderViewDto })
  reject(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.staff.act(
      requireStaffOrganizationId(req),
      id,
      { type: 'reject', reason: dto.reason },
      req.user.id,
      dto.expectedStatus,
    );
  }

  @StaffAccess('orders')
  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Keyingi bosqichga o'tkazish (tayyorlanmoqda → yo'lda/tayyor → yakunlandi)",
  })
  @ApiOkResponse({ type: StaffOrderViewDto })
  advance(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpectedStatusDto,
  ) {
    return this.staff.act(
      requireStaffOrganizationId(req),
      id,
      { type: 'next' },
      req.user.id,
      dto.expectedStatus,
    );
  }

  @StaffAccess('orders')
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Aniq holatga o'tkazish (holatlar mashinasi ruxsat bergan taqdirda)",
  })
  @ApiOkResponse({ type: StaffOrderViewDto })
  setStatus(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrderStatusDto,
  ) {
    return this.staff.act(
      requireStaffOrganizationId(req),
      id,
      { type: 'set', status: dto.status },
      req.user.id,
      dto.expectedStatus,
    );
  }
}
