import { Worker } from 'bullmq';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisOptions } from 'ioredis';
import { bullConnection } from 'src/infra/redis/bull-connection';

export const redisConfig: RedisOptions = bullConnection();

@Injectable()
export class BullConfigService implements OnModuleDestroy {
  onModuleDestroy() {
    console.log('🧹 Gracefully shutting down BullMQ...');
  }
}
