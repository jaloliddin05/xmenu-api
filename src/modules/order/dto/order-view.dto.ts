import { PAYMENT_METHODS } from '../domain/delivery-payment';
import { ApiProperty } from '@nestjs/swagger';
import { ORDER_STATUSES } from '../domain/order-state-machine';
import { POS_ORDER_STATES } from '../services/order-view';

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
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: string;
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
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'handed_to_external: the name of the external delivery service',
  })
  externalService: string | null;
}

class OrderExternalDto {
  @ApiProperty() service: string;
  @ApiProperty({ description: 'What the venue paid the service' }) cost: number;
  @ApiProperty({ format: 'date-time' }) handedAt: string;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Cash orders: whether the venue got the money (POST /order/:id/external-payment); null: not marked yet, or not a cash order',
  })
  cashReceived: boolean | null;
  @ApiProperty({
    description: 'A cash order still waits for the payment mark',
  })
  paymentMarkPending: boolean;
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
    enum: ['customer', 'restaurant', 'courier', 'system', 'payment', 'pos'],
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
    example: 'Dilshod Karimov',
    description:
      'Name of the staff member (actor restaurant) or the courier (actor courier) of this venue; null for the guest, the system, the payment and an unknown id',
  })
  actorName: string | null;
  @ApiProperty({
    enum: ['owner', 'operator'],
    nullable: true,
    description: 'Role of the staff member for actor restaurant; else null',
  })
  actorRole: 'owner' | 'operator' | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'With from = to the entry is not a status change: courier_assigned:<id>, courier_reassigned:<id>, courier_unassigned:<id>, iiko:<event> (docs/API.md, "Передача заказа в iiko"); actor pos: iiko:<DeliveryStatus>',
  })
  note: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

/** Why an order did not get into iiko (pos_order.error) */
export const POS_ORDER_REASONS = [
  'pos_unavailable',
  'pos_not_taken',
  'pos_rejected_stop_list',
  'pos_rejected_price',
  'pos_rejected_data',
  'pos_key_invalid',
  'pos_module_missing',
  'pos_access_denied',
  'pos_access_blocked',
  'unmapped_branch',
  'unmapped_item',
  'unmapped_payment',
  'unmapped_delivery_item',
] as const;

/** The order in iiko (docs/API.md, "Передача заказа в iiko") */
export class PosOrderViewDto {
  @ApiProperty({
    enum: POS_ORDER_STATES,
    description:
      'queued: waiting for an attempt; sending: iiko is creating it; sent: in iiko; failed: not sent ' +
      '(«Повторить» or «Внесён вручную»); needs_street: the operator picks a street of the iiko directory; ' +
      'manual: entered into iiko by hand',
  })
  state: string;

  @ApiProperty({
    enum: POS_ORDER_REASONS,
    nullable: true,
    type: String,
    description: 'Why the last attempt failed (null after a success)',
  })
  error: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Number in iiko' })
  posNumber: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last iiko delivery status (CookingStarted, OnWay, ...)',
  })
  posStatus: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Courier named by iiko (courier mode "iiko")',
  })
  courierName: string | null;

  @ApiProperty({ description: 'Attempts of the current round (up to 5)' })
  attempts: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  sentAt: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  manualAt: string | null;

  @ApiProperty({
    enum: ['none', 'pending', 'on_way', 'done', 'failed'],
    description:
      'Own couriers: "on the way" and "delivered" passed to iiko after the courier delivered. failed: the status in iiko was not updated (iiko refused, or its status did not allow it); the operator was alerted and closes it in iiko',
  })
  deliveredPush: string;
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
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readyAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '"Picked up" pressed',
  })
  pickedUpAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'problem_at_door after "no answer": when the wait at the door is over (then the operator decides)',
  })
  doorWaitEndsAt: string | null;
  @ApiProperty({
    enum: ['cash', 'card'],
    nullable: true,
    description:
      'Delivered orders paid at the door (cash or card): banknotes (handed in at the shift end) or a card to the courier',
  })
  cashCollected: 'cash' | 'card' | null;
  @ApiProperty({ type: OrderExternalDto, nullable: true })
  external: OrderExternalDto | null;
  @ApiProperty({
    type: PosOrderViewDto,
    nullable: true,
    description:
      'Transfer to iiko; null when the branch is not linked to iiko or the order was not accepted',
  })
  pos: PosOrderViewDto | null;
  @ApiProperty({ type: [OrderEventDto] }) events: OrderEventDto[];
}

/** Timer thresholds of the venue (order settings, minutes) for highlighting late orders */
export class OrderRemindersDto {
  @ApiProperty({
    example: 5,
    description: '"Picked up" not pressed this long after "ready"',
  })
  pickupReminderMinutes: number;
  @ApiProperty({ example: 60, description: 'On the way longer than this' })
  onTheWayAlertMinutes: number;
  @ApiProperty({
    example: 10,
    description: 'Wait at the door after "no answer"',
  })
  doorWaitMinutes: number;
  @ApiProperty({
    example: 0,
    description:
      'Unfinished orders not sent to iiko or waiting for a street (0 without iiko)',
  })
  posFailed: number;
  @ApiProperty({
    description: 'iiko does not take the venue key: the owner reconnects iiko',
  })
  posReconnect: boolean;
  @ApiProperty({
    description:
      'Couriers of the venue work in iiko: courier functions of Xmenu answer 409 pos_couriers_managed',
  })
  posCouriers: boolean;
}

export class StaffOrderListDto {
  @ApiProperty({ type: [StaffOrderViewDto] }) items: StaffOrderViewDto[];
  @ApiProperty({
    type: OrderRemindersDto,
    description:
      'The reminder thresholds of the venue, for the operator too (who cannot read /order-settings)',
  })
  reminders: OrderRemindersDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as ?cursor= for the next page',
  })
  nextCursor: string | null;
}
