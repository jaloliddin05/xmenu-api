import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CustomerSessionService } from './customer-session.service';

/**
 * Kuniga bir marta: 7 kundan ortiq muddati o'tgan sessiyalar va 90 kundan eski audit yozuvlarini o'chiradi.
 * Operatsiya idempotent, shuning uchun bir nechta instance'da ishlashi zarar qilmaydi.
 * (Xohlasangiz BullMQ repeatable job'ga ko'chirish mumkin.)
 */
@Injectable()
export class CustomerCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('CustomerCleanup');
  private timer?: NodeJS.Timeout;

  constructor(private readonly sessions: CustomerSessionService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 24 * 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    try {
      const r = await this.sessions.cleanup();
      this.logger.log(`tozalandi: sessions=${r.sessions} events=${r.events}`);
    } catch (err: any) {
      this.logger.warn(`tozalash xatosi: ${err?.message}`);
    }
  }
}
