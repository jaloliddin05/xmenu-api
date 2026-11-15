import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { OrderCoreModule } from '../order/order-core.module';
import { OrderModule } from '../order/order.module';
import { TelegramModule } from '../telegram/telegram.module';
import {
  CourierController,
  CourierShiftController,
  ExternalServiceController,
  OrderCourierController,
} from './courier.controller';
import { ExternalServiceProvider } from './provider/external-service.provider';
import { OwnCouriersProvider } from './provider/own-couriers.provider';
import { CourierAssignmentService } from './services/courier-assignment.service';
import { CourierBotService } from './services/courier-bot.service';
import { CourierCardProcessor } from './services/courier-card.processor';
import { CourierCardService } from './services/courier-card.service';
import { CourierShiftService } from './services/courier-shift.service';
import { CourierService } from './services/courier.service';
import { CourierPayService } from './services/courier-pay.service';
import { DeliveryTimerProcessor } from './services/delivery-timer.processor';
import { ExternalDeliveryService } from './services/external-delivery.service';

/**
 * Own couriers of a venue (docs/DELIVERY.md): couriers, shifts, assignment, the courier side of the venue
 * bot, the delivery provider adapters (own couriers, an external service by hand), delivery timers, cash
 * reconciliation and courier pay. The venue bot's update worker (auth module) hands courier updates
 * to OwnCouriersProvider.
 */
@Module({
  imports: [PrismaModule, OrderCoreModule, OrderModule, TelegramModule],
  controllers: [
    CourierController,
    CourierShiftController,
    OrderCourierController,
    ExternalServiceController,
  ],
  providers: [
    CourierService,
    CourierShiftService,
    CourierAssignmentService,
    CourierCardService,
    CourierCardProcessor,
    CourierBotService,
    OwnCouriersProvider,
    ExternalServiceProvider,
    ExternalDeliveryService,
    CourierPayService,
    DeliveryTimerProcessor,
  ],
  exports: [OwnCouriersProvider],
})
export class CourierModule {}
