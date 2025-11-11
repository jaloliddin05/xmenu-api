import { Injectable } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { sendApplicationToTelegram } from 'src/infra/helper/tg-bot/otp-bot';

@Injectable()
export class ApplicationService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    // 1️⃣ DB ga yozish
    const application = await this.prisma.application.create({
      data: dto,
    });

    // 2️⃣ Telegram ga yuborish
    await sendApplicationToTelegram(dto);

    return application;
  }

  async findAll() {
    return this.prisma.application.findMany({
      orderBy: { created_at: 'desc' },
    });
  }
}
