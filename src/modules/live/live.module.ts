import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { PrismaModule } from 'src/modules/_prisma/prisma.module';
import { TenantModule } from 'src/modules/tenant/tenant.module';
import { LiveEventBus } from './live-event-bus';
import { LiveOrderNotifier } from './live-order-notifier';
import { LiveEventsController } from './live-events.controller';
import { LiveStatsService } from './live-stats.service';
import { LiveStreamService } from './live-stream.service';
import { LIVE_TRANSPORT, RedisLiveTransport } from './live-transport';

/**
 * Live events (SSE): data on screens changes by events, never by polling. Global, so any service publishes after its
 * commit through LiveEventBus. Contract: docs/API.md, "События (SSE)".
 */
@Global()
@Module({
  // TenantModule: the guest and public streams resolve the venue by X-Tenant-Id (TenantGuard)
  imports: [PrismaModule, TenantModule],
  controllers: [LiveEventsController],
  providers: [
    {
      provide: LIVE_TRANSPORT,
      useFactory: (redis: Redis) => new RedisLiveTransport(redis),
      inject: [REDIS],
    },
    LiveEventBus,
    LiveOrderNotifier,
    LiveStreamService,
    LiveStatsService,
  ],
  exports: [LiveEventBus, LiveOrderNotifier, LiveStreamService],
})
export class LiveModule {}
