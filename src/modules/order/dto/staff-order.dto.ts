import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ORDER_STATUSES } from '../domain/order-state-machine';

/**
 * The status the operator saw (a board card, a button): the order moves only while it is still in it, otherwise
 * 409 order_status_conflict with details.status. Without it the action works as before (repeat = 200).
 */
export class ExpectedStatusDto {
  @ApiPropertyOptional({
    enum: ORDER_STATUSES,
    description:
      'The status the operator acted on; another current status → 409 order_status_conflict',
  })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  readonly expectedStatus?: (typeof ORDER_STATUSES)[number];
}

/** A kitchen step ("advance", a status): with iiko leading the order only with override (docs/IIKO.md). */
export class KitchenStepDto extends ExpectedStatusDto {
  @ApiPropertyOptional({
    description:
      'Mark a kitchen step (preparing, ready) of an order iiko leads anyway; without it 409 pos_status_managed. Written to the history',
  })
  @IsOptional()
  @IsBoolean()
  readonly override?: boolean;
}

export class RejectOrderDto extends ExpectedStatusDto {
  @ApiPropertyOptional({ example: 'out_of_stock' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly reason?: string;
}

/**
 * Statuses the restaurant sets itself. Delivery: accepted → ready, and returned_to_restaurant after a problem
 * at the door; "on the way" and "delivered" are the courier's (bot buttons). Pickup: preparing, ready,
 * completed; `ready` from accepted passes preparing in the same request (both steps in the journal).
 * Cancelling is POST /order/:id/reject with a reason.
 */
const STAFF_SETTABLE = [
  'accepted',
  'preparing',
  'ready',
  'completed',
  'returned_to_restaurant',
] as const;

export class SetOrderStatusDto extends KitchenStepDto {
  @ApiProperty({ enum: STAFF_SETTABLE })
  @IsIn(STAFF_SETTABLE)
  readonly status: (typeof STAFF_SETTABLE)[number];
}
