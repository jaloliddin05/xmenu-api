import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { ORDER_STATUSES, OrderStatusName } from '../domain/order-state-machine';
import { AcceptOrderDto, RejectOrderDto, SetOrderStatusDto } from '../dto/staff-order.dto';
import { OrderStaffService } from '../services/order-staff.service';

/** Restoran paneli: kelgan buyurtmalar va ularni boshqarish. Tenant — tokendagi organization. */
@ApiTags('Orders (staff)')
@Controller('order')
export class StaffOrderController {
  constructor(private readonly staff: OrderStaffService) {}

  @Get()
  @ApiOperation({ summary: "Buyurtmalar ro'yxati (yangilari birinchi, cursor pagination)" })
  @ApiQuery({ name: 'status', required: false, description: "Vergul bilan: pending_acceptance,accepted" })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(@Req() req, @Query('status') status?: string, @Query('branchId') branchId?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const statuses = (status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatusName => (ORDER_STATUSES as readonly string[]).includes(s));
    return this.staff.list(requireStaffOrganizationId(req), { statuses, branchId, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id')
  @ApiOperation({ summary: "Buyurtma tafsiloti (mijoz, status tarixi bilan)" })
  get(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(requireStaffOrganizationId(req), id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Qabul qilish (ixtiyoriy: ETA)' })
  accept(@Req() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptOrderDto) {
    const eta = dto.etaMin && dto.etaMax && dto.etaMax >= dto.etaMin ? { min: dto.etaMin, max: dto.etaMax } : undefined;
    return this.staff.act(requireStaffOrganizationId(req), id, { type: 'accept', eta }, req.user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rad etish (to\'langan bo\'lsa pul qaytariladi)' })
  reject(@Req() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectOrderDto) {
    return this.staff.act(requireStaffOrganizationId(req), id, { type: 'reject', reason: dto.reason }, req.user.id);
  }

  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Keyingi bosqichga o'tkazish (tayyorlanmoqda → yo'lda/tayyor → yakunlandi)" })
  advance(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.act(requireStaffOrganizationId(req), id, { type: 'next' }, req.user.id);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Aniq holatga o'tkazish (holatlar mashinasi ruxsat bergan taqdirda)" })
  setStatus(@Req() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetOrderStatusDto) {
    return this.staff.act(requireStaffOrganizationId(req), id, { type: 'set', status: dto.status }, req.user.id);
  }
}
