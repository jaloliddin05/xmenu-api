import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { OrderCoreModule } from '../order/order-core.module';
import { OrderModule } from '../order/order.module';
import { TelegramModule } from '../telegram/telegram.module';
import {
  CourierController,
  CourierShiftController,
  OrderCourierController,
} from './courier.controller';
import { OwnCouriersProvider } from './provider/own-couriers.provider';
import { CourierAssignmentService } from './services/courier-assignment.service';
import { CourierBotService } from './services/courier-bot.service';
import { CourierCardProcessor } from './services/courier-card.processor';
import { CourierCardService } from './services/courier-card.service';
import { CourierShiftService } from './services/courier-shift.service';
import { CourierService } from './services/courier.service';

/**
 * Own couriers of a venue (docs/DELIVERY.md): couriers, shifts, assignment, the courier side of the venue
 * bot and the delivery provider adapter. The venue bot's update worker (auth module) hands courier updates
 * to OwnCouriersProvider.
 */
@Module({
  imports: [PrismaModule, OrderCoreModule, OrderModule, TelegramModule],
  controllers: [
    CourierController,
    CourierShiftController,
    OrderCourierController,
  ],
  providers: [
    CourierService,
    CourierShiftService,
    CourierAssignmentService,
    CourierCardService,
    CourierCardProcessor,
    CourierBotService,
    OwnCouriersProvider,
  ],
  exports: [OwnCouriersProvider],
})
export class CourierModule {}
