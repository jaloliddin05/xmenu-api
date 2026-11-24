import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { PushController } from './push.controller';
import { PushSubscriptionService } from './push-subscription.service';
import { StaffPushDelivery } from './staff-push-delivery.service';
import { BullStaffPushQueue, STAFF_PUSH_QUEUE } from './staff-push.queue';
import { StaffPushService } from './staff-push.service';
import { WEB_PUSH_SENDER, WebPushSender } from './web-push.sender';

/**
 * Web push to the venue staff (docs/API.md, "Web push сотрудникам"): subscriptions of staff browsers and the
 * order notifications. Depends on nothing but the database and Redis, so the order core, auth and staff modules
 * import it without cycles.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PushController],
  providers: [
    PushSubscriptionService,
    StaffPushService,
    StaffPushDelivery,
    { provide: WEB_PUSH_SENDER, useClass: WebPushSender },
    { provide: STAFF_PUSH_QUEUE, useClass: BullStaffPushQueue },
  ],
  exports: [PushSubscriptionService, StaffPushService],
})
export class PushModule {}
