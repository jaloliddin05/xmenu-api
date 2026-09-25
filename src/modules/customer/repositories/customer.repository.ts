import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';

@Injectable()
export class CustomerRepository {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findById(id: string) {
    return this.prisma.customer.findUnique({
      where: {
        id,
      },
    });
  }

  async findByPhone(phone: string) {
    return this.prisma.customer.findUnique({
      where: {
        phone,
      },
    });
  }

  async findByTelegramId(telegramId: string) {
    return this.prisma.customer.findUnique({
      where: {
        telegram_id: telegramId,
      },
    });
  }

  async create(
    data: Prisma.customerCreateInput,
  ) {
    return this.prisma.customer.create({
      data,
    });
  }

  async update(
    id: string,
    data: Prisma.customerUpdateInput,
  ) {
    return this.prisma.customer.update({
      where: {
        id,
      },
      data,
    });
  }
}