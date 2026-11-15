import { ApiProperty } from '@nestjs/swagger';
import { ORDER_STATUSES } from '../domain/order-state-machine';

/** Customer and staff order object (docs/ORDERS_API.md, "Объект заказа"). */

class OrderBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() address: string;
}

class OrderPaymentDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Payment link, only in awaiting_payment',
  })
  url: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expiresAt: string | null;
  @ApiProperty({
    enum: ['declined', 'expired', 'cancelled'],
    nullable: true,
    description: 'Only in payment_failed',
  })
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
  @ApiProperty({ type: [OrderModifierOptionDto] })
  options: OrderModifierOptionDto[];
}

class OrderCourierNameDto {
  @ApiProperty() name: string;
}

class OrderCourierDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
}

// Not OrderItemDto: Swagger keys schemas by class name, and create-order.dto.ts has an OrderItemDto of its own
class OrderViewItemDto {
  @ApiProperty({ description: 'Menu item id (snapshot)' }) itemId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) image: string | null;
  @ApiProperty({ example: '300 g' }) weight: string;
  @ApiProperty({ example: 'UZS' }) currency: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPrice: number;
  @ApiProperty({ type: [OrderModifierGroupDto] })
  modifiers: OrderModifierGroupDto[];
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
  @ApiProperty({
    enum: [
      'not_required',
      'pending',
      'paid',
      'failed',
      'cancelled',
      'refund_pending',
      'refunded',
    ],
  })
  paymentStatus: string;
  @ApiProperty({
    type: OrderPaymentDto,
    nullable: true,
    description: 'null for cash',
  })
  payment: OrderPaymentDto | null;
  @ApiProperty({ type: [OrderViewItemDto] }) items: OrderViewItemDto[];
  @ApiProperty({ example: 'UZS' }) currency: string;
  @ApiProperty() subtotal: number;
  @ApiProperty({
    description:
      'Delivery fee fixed when the order was placed; 0 for pickup and free delivery',
  })
  deliveryFee: number;
  @ApiProperty() discount: number;
  @ApiProperty() total: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 200000,
    description: 'Cash: the amount the guest pays with (change is due)',
  })
  cashChangeFrom: number | null;
  @ApiProperty({ enum: ['customer', 'restaurant', 'system'], nullable: true })
  cancelledBy: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({
    type: OrderCourierNameDto,
    nullable: true,
    description:
      'The courier while on the way or at the door (name only); null otherwise',
  })
  courier: OrderCourierNameDto | null;
  @ApiProperty({
    enum: ['no_answer', 'refused'],
    nullable: true,
    description:
      'problem_at_door: no_answer — the courier cannot reach the guest; refused — the guest refused',
  })
  doorProblem: 'no_answer' | 'refused' | null;
}

class OrderCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
}

class OrderEventDto {
  @ApiProperty({ enum: ORDER_STATUSES, nullable: true }) from: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) to: string;
  @ApiProperty({
    enum: ['customer', 'restaurant', 'courier', 'system', 'payment'],
  })
  actor: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Staff user id, courier id (actor courier) or customer id',
  })
  actorId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'With from = to the entry is not a status change: courier_assigned:<id>, courier_reassigned:<id>, courier_unassigned:<id>',
  })
  note: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

/** GET /order/:id and the result of staff actions: the order plus customer and status history. */
export class StaffOrderViewDto extends OrderViewDto {
  @ApiProperty({ type: OrderCustomerDto }) customer: OrderCustomerDto;
  @ApiProperty({
    type: OrderCourierDto,
    nullable: true,
    description: 'The courier assigned now (any status); the staff view only',
  })
  // Overrides the guest field (name only); the class only describes the response for Swagger
  courier: OrderCourierDto | null = null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  courierAssignedAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'refused: changed_mind | wrong_order | quality | other',
  })
  doorProblemReason: string | null;
  @ApiProperty({ type: [OrderEventDto] }) events: OrderEventDto[];
}

export class StaffOrderListDto {
  @ApiProperty({ type: [StaffOrderViewDto] }) items: StaffOrderViewDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as ?cursor= for the next page',
  })
  nextCursor: string | null;
}
