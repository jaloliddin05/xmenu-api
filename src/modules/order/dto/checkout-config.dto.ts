import { ApiProperty } from '@nestjs/swagger';
import {
  PAYMENT_METHODS as METHODS,
  type PaymentMethod as Method,
} from '../domain/delivery-payment';

export class CheckoutPaymentMethodsDto {
  @ApiProperty({
    enum: METHODS,
    isArray: true,
    description:
      'The methods the venue switched on for delivery (order settings deliveryPayment): cash and card (to the courier) unless only external services deliver; click/payme when online is on and the venue set its keys',
  })
  delivery: Method[];
  @ApiProperty({
    enum: METHODS,
    isArray: true,
    description:
      'cash always; click/payme when the venue set its keys; never card',
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
