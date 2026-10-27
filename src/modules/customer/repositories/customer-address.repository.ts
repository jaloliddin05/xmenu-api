import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';

export interface AddressRecord {
  id: string;
  title: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  comment: string | null;
  is_default: boolean;
  created_at: Date;
}

export type NewAddressRecord = Omit<AddressRecord, 'id' | 'created_at'>;

/**
 * Bitta mijozning manzillari ustidagi atomar amallar. Faqat withCustomerLock()
 * ichida beriladi, ya'ni mijoz qatori bloklangan tranzaksiyada — shuning
 * uchun biznes-qoidalar (limit, "bitta asosiy") poyga holatisiz tekshiriladi.
 * Interfeys sodda saqlangan: servis testlarida xotiradagi soxta store bilan
 * almashtiriladi.
 */
export interface AddressStore {
  count(): Promise<number>;
  findById(id: string): Promise<AddressRecord | null>;
  /** Eng yangi saqlangan manzil — asosiy o'chirilganda unga o'tkaziladi. */
  findNewest(): Promise<AddressRecord | null>;
  insert(data: NewAddressRecord): Promise<AddressRecord>;
  delete(id: string): Promise<void>;
  clearDefault(): Promise<void>;
  markDefault(id: string): Promise<AddressRecord>;
}

/**
 * customer_address da tenant ustuni yo'q: tenant customer orqali aniqlanadi
 * (customer.organization_id). Shuning uchun HAR BIR so'rov tenantId ni
 * mijoz orqali tekshiradi — token boshqa tenantniki bo'lsa ham, boshqa
 * mijozning manzili ko'rinmaydi va o'zgarmaydi.
 */
@Injectable()
export class CustomerAddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, customerId: string): Promise<AddressRecord[]> {
    return this.prisma.customer_address.findMany({
      where: {
        customer_id: customerId,
        customer: { organization_id: tenantId, deleted_at: null },
      },
      // Asosiy manzil birinchi, qolganlari yangidan eskiga. id — bir xil
      // created_at bo'lganda tartib har so'rovda o'zgarmasligi uchun.
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Mijoz qatorini FOR UPDATE bilan bloklaydi va shu tranzaksiyada fn ni
   * bajaradi. Bir mijozning parallel yozuvlari (ikki marta bosilgan
   * "Saqlash", ikki qurilma) navbat bilan o'tadi, shuning uchun:
   *  - limit tekshiruvi (count -> insert) oraliqda buzilmaydi;
   *  - "bitta asosiy" almashtirish ikki so'rov o'rtasida ikkita asosiy
   *    qoldirmaydi (bazadagi partial unique index bunga ikkinchi himoya).
   *
   * Mijoz topilmasa/o'chirilgan bo'lsa — token eskirgan (invalid_token);
   * bloklangan bo'lsa — customer_blocked. Tenant ham shu yerda tekshiriladi.
   */
  withCustomerLock<T>(
    tenantId: string,
    customerId: string,
    fn: (store: AddressStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"::text AS "status"
        FROM "public"."customer"
        WHERE "id" = ${customerId}
          AND "organization_id" = ${tenantId}
          AND "deleted_at" IS NULL
        FOR UPDATE`;

      if (rows.length === 0) throw new CustomerAuthException('invalid_token');
      if (rows[0].status === 'blocked')
        throw new CustomerAuthException('customer_blocked');

      return fn(this.createStore(tx, customerId));
    });
  }

  private createStore(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): AddressStore {
    return {
      count: () =>
        tx.customer_address.count({ where: { customer_id: customerId } }),

      findById: (id) =>
        tx.customer_address.findFirst({
          where: { id, customer_id: customerId },
        }),

      findNewest: () =>
        tx.customer_address.findFirst({
          where: { customer_id: customerId },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        }),

      insert: (data) =>
        tx.customer_address.create({
          data: { ...data, customer_id: customerId },
        }),

      delete: async (id) => {
        await tx.customer_address.deleteMany({
          where: { id, customer_id: customerId },
        });
      },

      clearDefault: async () => {
        await tx.customer_address.updateMany({
          where: { customer_id: customerId, is_default: true },
          data: { is_default: false },
        });
      },

      markDefault: (id) =>
        tx.customer_address.update({
          where: { id, customer_id: customerId },
          data: { is_default: true },
        }),
    };
  }
}
