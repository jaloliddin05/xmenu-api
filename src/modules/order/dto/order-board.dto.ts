import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_METHODS } from '../domain/delivery-payment';
import { ATTENTION_CODES } from '../domain/order-board';
import { LIVE_STATUSES } from '../domain/order-state-machine';
import { OrderRemindersDto } from './order-view.dto';

export class BoardItemPreviewDto {
  @ApiProperty({ example: 'Плов' }) name: string;
  @ApiProperty({ example: 2 }) quantity: number;
}

export class BoardCourierDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Bekzod' }) name: string;
}

/** One live order on the board: no guest name or phone, no history (GET /order/:id has them). */
export class BoardItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 1042 }) number: number;
  @ApiProperty({ enum: LIVE_STATUSES }) status: string;
  @ApiProperty({ enum: ['delivery', 'pickup'] }) fulfillmentMode: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({
    format: 'date-time',
    description:
      'Entered the current status (journal); the board sorts by it, oldest first',
  })
  statusSince: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'pending_acceptance only: auto-cancel moment = entering pending_acceptance (after the payment for online orders) + acceptanceTimeoutSeconds',
  })
  acceptDeadlineAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Amir Temur ko‘chasi, 15',
    description:
      'Street line of the delivery address (no entrance, floor, flat or comment); null for pickup',
  })
  shortAddress: string | null;
  @ApiProperty({ example: 5, description: 'Sum of quantities' })
  itemsCount: number;
  @ApiProperty({
    type: [BoardItemPreviewDto],
    description: 'First 4 positions',
  })
  itemsPreview: BoardItemPreviewDto[];
  @ApiProperty({ example: 125000 }) total: number;
  @ApiProperty({ example: 'UZS' }) currency: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: string;
  @ApiProperty({ type: Number, nullable: true, example: 200000 })
  cashChangeFrom: number | null;
  @ApiProperty({ type: BoardCourierDto, nullable: true })
  courier: BoardCourierDto | null;
  @ApiProperty({
    enum: ATTENTION_CODES,
    isArray: true,
    description:
      'What needs the operator (docs/API.md, "Доска заказов"); courier codes only for deliveries with Xmenu couriers',
  })
  attention: string[];
  @ApiProperty({
    example: 3,
    description: 'Order version (changes with every status change)',
  })
  version: number;
}

export class BoardThresholdsDto extends OrderRemindersDto {
  @ApiProperty({
    example: 300,
    description: 'Unanswered orders are cancelled after this',
  })
  acceptanceTimeoutSeconds: number;
}

export class BoardTodayDto {
  @ApiProperty({
    example: 37,
    description:
      'Orders that reached the venue today (entered pending_acceptance), Asia/Tashkent day',
  })
  ordersCount: number;
  @ApiProperty({ example: 30, description: 'Orders completed today' })
  completedCount: number;
  @ApiProperty({
    example: 3450000,
    description: 'Sum of totals of the orders completed today',
  })
  revenue: number;
}

export class OrderBoardDto {
  @ApiProperty({
    format: 'date-time',
    description: 'Count the timers from this, not from the device clock',
  })
  serverTime: string;
  @ApiProperty({ type: [BoardItemDto] }) items: BoardItemDto[];
  @ApiProperty({ type: BoardThresholdsDto }) thresholds: BoardThresholdsDto;
  @ApiProperty({ type: BoardTodayDto }) today: BoardTodayDto;
  @ApiProperty({ example: 30, description: 'Same as today.completedCount' })
  completedTodayCount: number;
}
