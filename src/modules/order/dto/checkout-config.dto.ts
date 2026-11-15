import { ApiProperty } from '@nestjs/swagger';

const METHODS = ['cash', 'click', 'payme'] as const;
type Method = (typeof METHODS)[number];

export class CheckoutPaymentMethodsDto {
  @ApiProperty({
    enum: METHODS,
    isArray: true,
    description:
      'cash unless only external services deliver (courier mode external); click/payme when the venue set its keys',
  })
  delivery: Method[];
  @ApiProperty({
    enum: METHODS,
    isArray: true,
    description: 'cash always; click/payme when the venue set its keys',
  })
  pickup: Method[];
}

/**
 * GET /checkout-config: the values the server prices an order with that do not depend on the address. The
 * delivery fee and minimum come from GET /delivery/quote.
 */
export class CheckoutConfigDto {
  @ApiProperty({ example: 'UZS', description: "The venue's currency" })
  currency: string;
  @ApiProperty({ example: 0, description: 'Minimum pickup order (sum)' })
  minOrderPickup: number;
  @ApiProperty({ type: CheckoutPaymentMethodsDto })
  paymentMethods: CheckoutPaymentMethodsDto;
}
