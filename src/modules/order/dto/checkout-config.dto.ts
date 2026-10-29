import { ApiProperty } from '@nestjs/swagger';

export class MinOrderDto {
  @ApiProperty({ example: 40000 }) delivery: number;
  @ApiProperty({ example: 0 }) pickup: number;
}

/** GET /checkout-config: the values the server prices an order with. */
export class CheckoutConfigDto {
  @ApiProperty({ example: 'UZS', description: "The venue's currency" })
  currency: string;
  @ApiProperty({ example: 5000, description: 'Added to delivery orders' })
  deliveryServiceFee: number;
  @ApiProperty({ type: MinOrderDto }) minOrder: MinOrderDto;
  @ApiProperty({
    type: [Number],
    minItems: 2,
    maxItems: 2,
    example: [20, 30],
    description: '[min, max] minutes',
  })
  etaMinutes: [number, number];
  @ApiProperty({
    enum: ['cash', 'click', 'payme'],
    isArray: true,
    description: 'cash always; click/payme when the venue set its keys',
  })
  paymentMethods: ('cash' | 'click' | 'payme')[];
}
