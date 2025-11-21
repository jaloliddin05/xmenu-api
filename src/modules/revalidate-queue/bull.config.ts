import { Queue, Worker, QueueEvents } from 'bullmq';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisOptions } from 'ioredis';

export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
};

@Injectable()
export class BullConfigService implements OnModuleDestroy {
  async onModuleDestroy() {
    console.log('🧹 Gracefully shutting down BullMQ...');
  }
}
