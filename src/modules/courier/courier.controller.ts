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
  CourierPayRateDto,
  CourierPayRatesDto,
  CourierViewDto,
  CreateCourierDto,
  ExternalPaymentDto,
  HandToExternalDto,
  ReconcileShiftDto,
  ShiftListQueryDto,
  ShiftViewDto,
  UpdateCourierDto,
} from './dto/courier.dto';
import { ExternalServiceProvider } from './provider/external-service.provider';
import { CourierAssignmentService } from './services/courier-assignment.service';
import { CourierPayService } from './services/courier-pay.service';
import { ExternalDeliveryService } from './services/external-delivery.service';
import { CourierShiftService } from './services/courier-shift.service';
import { CourierService } from './services/courier.service';

/** Couriers of the venue (owner and operator): docs/API.md, "Курьеры". */
@ApiTags('Couriers (staff)')
@ApiBearerAuth('access-token')
@Controller('couriers')
export class CourierController {
  constructor(
    private readonly couriers: CourierService,
    private readonly pay: CourierPayService,
  ) {}

  @StaffAccess('couriers')
  @Get()
  @ApiOperation({
    summary: 'Couriers with their state: off shift, free, busy with N orders',
  })
  @ApiOkResponse({ type: CourierViewDto, isArray: true })
  list(@Req() req: StaffRequest) {
    return this.couriers.list(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Get('pay-rates')
  @ApiOperation({
    summary:
      "Courier pay rates (owner only): the venue's and each courier's own one",
  })
  @ApiOkResponse({ type: CourierPayRatesDto })
  payRates(@Req() req: StaffRequest) {
    return this.pay.rates(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Put(':id/pay-rate')
  @ApiOperation({
    summary:
      "Set or remove (rate: null) the courier's own pay rate; later deliveries only",
  })
  @ApiOkResponse({ type: CourierPayRatesDto })
  setPayRate(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CourierPayRateDto,
  ) {
    return this.pay.setRate(
      requireStaffOrganizationId(req),
      id,
      dto.rate ?? null,
    );
  }

  @StaffAccess('couriers.manage')
  @Post()
  @ApiOperation({
    summary: 'Add a courier (name, phone); 409 courier_phone_taken',
  })
  @ApiOkResponse({ type: CourierViewDto })
  create(@Req() req: StaffRequest, @Body() dto: CreateCourierDto) {
    return this.couriers.create(requireStaffOrganizationId(req), dto);
  }

  @StaffAccess('couriers.manage')
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

  @StaffAccess('couriers.manage')
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

  @StaffAccess('couriers.manage')
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
  @Get(':id')
  @ApiOperation({
    summary: 'One shift with its cash (the reconciliation screen)',
  })
  @ApiOkResponse({ type: ShiftViewDto })
  get(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.get(requireStaffOrganizationId(req), id);
  }

  @StaffAccess('shifts')
  @Post(':id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Enter the cash got from the courier, once per ended shift; 409 shift_not_awaiting_reconciliation',
  })
  @ApiOkResponse({ type: ShiftViewDto })
  reconcile(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileShiftDto,
  ) {
    return this.shifts.reconcile(
      requireStaffOrganizationId(req),
      id,
      dto.received,
      req.user.id,
    );
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
    private readonly external: ExternalServiceProvider,
    private readonly externalDelivery: ExternalDeliveryService,
  ) {}

  @StaffAccess('orders')
  @Post(':id/external')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hand the order to an external service (accepted or ready, no own courier); the order closes as handed_to_external. 409 order_courier_assigned, order_status_conflict',
  })
  @ApiOkResponse({ type: StaffOrderViewDto })
  async handToExternal(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandToExternalDto,
  ) {
    const org = requireStaffOrganizationId(req);
    await this.external.create(org, id, {
      actorId: req.user.id,
      external: { service: dto.service, cost: dto.cost },
    });
    return this.orders.get(org, id);
  }

  @StaffAccess('orders')
  @Post(':id/external-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'A cash order handed to an external service: did the venue get the money? Once; 409 external_payment_not_pending',
  })
  @ApiOkResponse({ type: StaffOrderViewDto })
  async externalPayment(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExternalPaymentDto,
  ) {
    const org = requireStaffOrganizationId(req);
    await this.externalDelivery.markPayment(org, id, dto.received, req.user.id);
    return this.orders.get(org, id);
  }

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

/** Names of external services the venue used before (owner and operator). */
@ApiTags('Orders (staff)')
@ApiBearerAuth('access-token')
@Controller('external-services')
export class ExternalServiceController {
  constructor(private readonly external: ExternalDeliveryService) {}

  @StaffAccess('orders')
  @Get()
  @ApiOperation({
    summary:
      'Service names for the handover form, the most recent first (up to 20)',
  })
  @ApiOkResponse({ type: String, isArray: true })
  list(@Req() req: StaffRequest) {
    return this.external.suggestions(requireStaffOrganizationId(req));
  }
}
