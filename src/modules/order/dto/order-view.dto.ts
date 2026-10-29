import { ApiProperty } from '@nestjs/swagger';
import { ORDER_STATUSES } from '../domain/order-state-machine';

/** Customer and staff order object (docs/ORDERS_API.md, "Объект заказа"). */

class OrderBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() address: string;
}

class OrderPaymentDto {
  @ApiProperty({ type: String, nullable: true, description: 'Payment link, only in awaiting_payment' }) url: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) expiresAt: string | null;
  @ApiProperty({ enum: ['declined', 'expired', 'cancelled'], nullable: true, description: 'Only in payment_failed' })
  failReason: 'declined' | 'expired' | 'cancelled' | null;
}

class OrderModifierOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() price: number;
}

class OrderModifierGroupDto {
  @ApiProperty() groupId: string;
  @ApiProperty() groupTitle: string;
  @ApiProperty({ type: [OrderModifierOptionDto] }) options: OrderModifierOptionDto[];
}

class OrderItemDto {
  @ApiProperty({ description: 'Menu item id (snapshot)' }) itemId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) image: string | null;
  @ApiProperty({ example: '300 g' }) weight: string;
  @ApiProperty({ example: 'UZS' }) currency: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
  @ApiProperty({ type: [OrderModifierGroupDto] }) modifiers: OrderModifierGroupDto[];
}

export class OrderViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 1001 }) number: number;
  @ApiProperty({ enum: ORDER_STATUSES }) status: string;
  @ApiProperty({ enum: ['delivery', 'pickup'] }) fulfillmentMode: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ type: OrderBranchDto }) branch: OrderBranchDto;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Delivery address snapshot (null for pickup)',
  })
  address: Record<string, unknown> | null;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty() comment: string;
  @ApiProperty({ enum: ['cash', 'click', 'payme'] }) paymentMethod: string;
  @ApiProperty({ enum: ['not_required', 'pending', 'paid', 'failed', 'cancelled', 'refund_pending', 'refunded'] })
  paymentStatus: string;
  @ApiProperty({ type: OrderPaymentDto, nullable: true, description: 'null for cash' }) payment: OrderPaymentDto | null;
  @ApiProperty({ type: [OrderItemDto] }) items: OrderItemDto[];
  @ApiProperty({ example: 'UZS' }) currency: string;
  @ApiProperty() subtotal: number;
  @ApiProperty() serviceFee: number;
  @ApiProperty() discount: number;
  @ApiProperty() total: number;
  @ApiProperty({ type: [Number], example: [30, 45], description: '[min, max] minutes' }) etaMinutes: number[];
  @ApiProperty({ enum: ['customer', 'restaurant', 'system'], nullable: true }) cancelledBy: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
}

class OrderCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
}

class OrderEventDto {
  @ApiProperty({ enum: ORDER_STATUSES, nullable: true }) from: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) to: string;
  @ApiProperty({ enum: ['customer', 'restaurant', 'system', 'payment'] }) actor: string;
  @ApiProperty({ type: String, nullable: true }) actorId: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

/** GET /order/:id and the result of staff actions: the order plus customer and status history. */
export class StaffOrderViewDto extends OrderViewDto {
  @ApiProperty({ type: OrderCustomerDto }) customer: OrderCustomerDto;
  @ApiProperty({ type: [OrderEventDto] }) events: OrderEventDto[];
}

export class StaffOrderListDto {
  @ApiProperty({ type: [StaffOrderViewDto] }) items: StaffOrderViewDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Pass as ?cursor= for the next page' })
  nextCursor: string | null;
}
