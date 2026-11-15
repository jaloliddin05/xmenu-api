import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { StaffOrderViewDto } from 'src/modules/order/dto/order-view.dto';
import { OrderStaffService } from 'src/modules/order/services/order-staff.service';
import {
  AssignCourierDto,
  CourierInvitationDto,
  CourierViewDto,
  CreateCourierDto,
  ShiftListQueryDto,
  ShiftViewDto,
  UpdateCourierDto,
} from './dto/courier.dto';
import { CourierAssignmentService } from './services/courier-assignment.service';
import { CourierShiftService } from './services/courier-shift.service';
import { CourierService } from './services/courier.service';

/** Couriers of the venue (owner and operator): docs/API.md, "Курьеры". */
@ApiTags('Couriers (staff)')
@ApiBearerAuth('access-token')
@Controller('couriers')
export class CourierController {
  constructor(private readonly couriers: CourierService) {}

  @StaffAccess('couriers')
  @Get()
  @ApiOperation({
    summary: 'Couriers with their state: off shift, free, busy with N orders',
  })
  @ApiOkResponse({ type: CourierViewDto, isArray: true })
  list(@Req() req: StaffRequest) {
    return this.couriers.list(requireStaffOrganizationId(req));
  }

  @StaffAccess('couriers')
  @Post()
  @ApiOperation({
    summary: 'Add a courier (name, phone); 409 courier_phone_taken',
  })
  @ApiOkResponse({ type: CourierViewDto })
  create(@Req() req: StaffRequest, @Body() dto: CreateCourierDto) {
    return this.couriers.create(requireStaffOrganizationId(req), dto);
  }

  @StaffAccess('couriers')
  @Patch(':id')
  @ApiOperation({ summary: 'Change the name or phone of an active courier' })
  @ApiOkResponse({ type: CourierViewDto })
  update(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourierDto,
  ) {
    return this.couriers.update(requireStaffOrganizationId(req), id, dto);
  }

  @StaffAccess('couriers')
  @Post(':id/invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One-time link to the venue bot, 24 hours; older links stop working. 422 telegram_bot_required without a working bot',
  })
  @ApiOkResponse({ type: CourierInvitationDto })
  invite(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.couriers.invite(requireStaffOrganizationId(req), id);
  }

  @StaffAccess('couriers')
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Disable at once: the bot refuses the courier, unfinished orders are taken off, an open shift ends',
  })
  @ApiOkResponse({ type: CourierViewDto })
  disable(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.couriers.disable(
      requireStaffOrganizationId(req),
      id,
      req.user.id,
    );
  }
}

/** Courier shifts (owner and operator). */
@ApiTags('Couriers (staff)')
@ApiBearerAuth('access-token')
@Controller('shifts')
export class CourierShiftController {
  constructor(private readonly shifts: CourierShiftService) {}

  @StaffAccess('shifts')
  @Get()
  @ApiOperation({ summary: 'Shifts, newest first; filter by status' })
  @ApiOkResponse({ type: ShiftViewDto, isArray: true })
  list(@Req() req: StaffRequest, @Query() q: ShiftListQueryDto) {
    return this.shifts.list(requireStaffOrganizationId(req), q.status);
  }

  @StaffAccess('shifts')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Close a courier shift for them; 409 courier_has_active_orders while orders are on the courier',
  })
  @ApiOkResponse({ type: ShiftViewDto })
  close(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.closeByStaff(
      requireStaffOrganizationId(req),
      id,
      req.user.id,
    );
  }
}

/** Assigning a courier to a delivery order (owner and operator). */
@ApiTags('Orders (staff)')
@ApiBearerAuth('access-token')
@Controller('order')
export class OrderCourierController {
  constructor(
    private readonly assignments: CourierAssignmentService,
    private readonly orders: OrderStaffService,
  ) {}

  @StaffAccess('orders')
  @Put(':id/courier')
  @ApiOperation({
    summary:
      'Assign or reassign the courier (on shift only) until "picked up"; then 409 order_courier_locked',
  })
  @ApiOkResponse({ type: StaffOrderViewDto })
  async assign(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCourierDto,
  ) {
    const org = requireStaffOrganizationId(req);
    await this.assignments.assign(org, id, dto.courierId, req.user.id);
    return this.orders.get(org, id);
  }

  @StaffAccess('orders')
  @Delete(':id/courier')
  @ApiOperation({ summary: 'Take the courier off the order until "picked up"' })
  @ApiOkResponse({ type: StaffOrderViewDto })
  async unassign(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const org = requireStaffOrganizationId(req);
    await this.assignments.unassign(org, id, req.user.id);
    return this.orders.get(org, id);
  }
}
