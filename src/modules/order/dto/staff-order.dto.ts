import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectOrderDto {
  @ApiPropertyOptional({ example: 'out_of_stock' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly reason?: string;
}

/**
 * Statuses the restaurant sets itself. Delivery: accepted → ready, and returned_to_restaurant after a problem
 * at the door; "on the way" and "delivered" are the courier's (bot buttons). Pickup: preparing, ready,
 * completed. Cancelling is POST /order/:id/reject with a reason.
 */
const STAFF_SETTABLE = [
  'accepted',
  'preparing',
  'ready',
  'completed',
  'returned_to_restaurant',
] as const;

export class SetOrderStatusDto {
  @ApiProperty({ enum: STAFF_SETTABLE })
  @IsIn(STAFF_SETTABLE)
  readonly status: (typeof STAFF_SETTABLE)[number];
}
