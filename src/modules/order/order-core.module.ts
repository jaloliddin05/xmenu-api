import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { CustomerNotifierService } from './notifications/customer-notifier.service';
import { OpsNotifierService } from './notifications/ops-notifier.service';
import { RestaurantNotifierService } from './notifications/restaurant-notifier.service';
import { EscalationProcessor } from './queue/escalation.processor';
import { OrderQueueService } from './queue/order-queue.service';
import { OrderSettingsService } from './services/order-settings.service';
import { OrderTransitionService } from './services/order-transition.service';
import { TelegramApiService } from './services/telegram-api.service';

/**
 * Buyurtma yadrosi: holat o'tishlari, navbatlar, xabarnomalar. HECH QAYSI
 * boshqa biznes-moduldan (to'lov, API controller'lar) import qilmaydi — shuning
 * uchun OrderModule ham, PaymentModule ham uni sikllarsiz ishlata oladi.
 */
@Module({
  imports: [PrismaModule, SmsModule],
  providers: [
    TelegramApiService,
    OrderSettingsService,
    OrderQueueService,
    RestaurantNotifierService,
    CustomerNotifierService,
    OpsNotifierService,
    OrderTransitionService,
    EscalationProcessor,
  ],
  exports: [
    TelegramApiService,
    OrderSettingsService,
    OrderQueueService,
    RestaurantNotifierService,
    CustomerNotifierService,
    OpsNotifierService,
    OrderTransitionService,
  ],
})
export class OrderCoreModule {}
