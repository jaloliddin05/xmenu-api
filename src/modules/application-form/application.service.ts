import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { sendApplicationToTelegram } from 'src/infra/helper/tg-bot/otp-bot';

@Injectable()
export class ApplicationService {
  private readonly logger = new Logger(ApplicationService.name);

  constructor(private prisma: PrismaService) {}

  /** Public landing form: answers only the new id, never the stored row. */
  async create(dto: CreateApplicationDto): Promise<{ id: string }> {
    // 1️⃣ DB ga yozish
    const application = await this.prisma.application.create({
      data: dto,
    });

    // 2️⃣ Telegram ga yuborish: best effort, the application is already saved
    try {
      await sendApplicationToTelegram(dto);
    } catch (e) {
      // the message carries Telegram's description only, never the bot token
      this.logger.warn(
        `Application ${application.id}: Telegram notification failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      );
    }

    return { id: application.id };
  }

  async findAll() {
    return this.prisma.application.findMany({
      orderBy: { created_at: 'desc' },
    });
  }
}
