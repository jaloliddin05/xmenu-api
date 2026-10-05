import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';

/**
 * Barcha so'rovlar tenantId (organization_id) bilan cheklangan:
 * tenantsiz mijoz so'rovi yozib bo'lmaydi. O'chirilgan (deleted_at) mijozlar ko'rinmaydi.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string) {
    return this.prisma.customer.findFirst({
      where: { id, organization_id: tenantId, deleted_at: null },
    });
  }

  findByPhone(tenantId: string, phone: string) {
    return this.prisma.customer.findFirst({
      where: { organization_id: tenantId, phone, deleted_at: null },
    });
  }

  findByTelegramId(tenantId: string, telegramId: string) {
    return this.prisma.customer.findFirst({
      where: { organization_id: tenantId, telegram_id: telegramId, deleted_at: null },
    });
  }

  create(
    tenantId: string,
    data: { phone: string; name: string; telegram_id?: string | null; last_login_at?: Date },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.customer.create({ data: { ...data, organization_id: tenantId } });
  }

  update(tenantId: string, id: string, data: Prisma.customerUpdateManyMutationInput) {
    return this.prisma.customer.updateMany({
      where: { id, organization_id: tenantId, deleted_at: null },
      data,
    });
  }
}
