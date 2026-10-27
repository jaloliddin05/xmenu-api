import { Injectable } from '@nestjs/common';
import { normalizeAddressInput } from 'src/infra/helper/customer/address-validators';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { CreateAddressDto } from '../dto';
import {
  AddressRecord,
  CustomerAddressRepository,
} from '../repositories/customer-address.repository';

/** Bir mijoz saqlay oladigan manzillar soni. Spam va nazoratsiz o'sishdan himoya. */
export const MAX_ADDRESSES_PER_CUSTOMER = 20;

/**
 * Frontend bilan kelishilgan format (camelCase, auth javoblari kabi).
 * `title` — foydalanuvchi bergan nom ("Uy"), `address` — ko'cha va uy.
 */
export interface AddressView {
  id: string;
  title: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  comment: string | null;
  isDefault: boolean;
  createdAt: string;
}

export const toAddressView = (a: AddressRecord): AddressView => ({
  id: a.id,
  title: a.title,
  address: a.address,
  latitude: a.latitude,
  longitude: a.longitude,
  entrance: a.entrance,
  floor: a.floor,
  apartment: a.apartment,
  comment: a.comment,
  isDefault: a.is_default,
  createdAt: a.created_at.toISOString(),
});

@Injectable()
export class CustomerAddressService {
  constructor(private readonly addresses: CustomerAddressRepository) {}

  async list(tenantId: string, customerId: string): Promise<AddressView[]> {
    const rows = await this.addresses.list(tenantId, customerId);
    return rows.map(toAddressView);
  }

  async create(
    tenantId: string,
    customerId: string,
    dto: CreateAddressDto,
  ): Promise<AddressView> {
    const input = normalizeAddressInput(dto);
    if (!input.ok)
      throw new CustomerAuthException('invalid_address', input.message);

    return this.addresses.withCustomerLock(
      tenantId,
      customerId,
      async (store) => {
        const existing = await store.count();
        if (existing >= MAX_ADDRESSES_PER_CUSTOMER) {
          throw new CustomerAuthException(
            'address_limit_reached',
            `Manzillar soni ${MAX_ADDRESSES_PER_CUSTOMER} tadan oshmasligi kerak`,
          );
        }

        // Birinchi manzil har doim asosiy: savatda tanlash uchun doim bitta
        // tayyor manzil bo'lsin, "asosiy yo'q" holati paydo bo'lmasin.
        const makeDefault = existing === 0 || dto.isDefault === true;
        if (makeDefault) await store.clearDefault();

        const row = await store.insert({
          ...input.value,
          is_default: makeDefault,
        });
        return toAddressView(row);
      },
    );
  }

  async remove(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<void> {
    await this.addresses.withCustomerLock(
      tenantId,
      customerId,
      async (store) => {
        const row = await store.findById(id);
        if (!row) throw new CustomerAuthException('address_not_found');

        await store.delete(id);

        // Asosiy manzil o'chirilsa, eng yangisi asosiy bo'ladi — mijoz bitta
        // manzil qoldirib "asosiy yo'q" holatiga tushib qolmasin.
        if (row.is_default) {
          const next = await store.findNewest();
          if (next) await store.markDefault(next.id);
        }
      },
    );
  }

  async setDefault(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<AddressView> {
    return this.addresses.withCustomerLock(
      tenantId,
      customerId,
      async (store) => {
        const row = await store.findById(id);
        if (!row) throw new CustomerAuthException('address_not_found');
        if (row.is_default) return toAddressView(row); // idempotent

        await store.clearDefault();
        return toAddressView(await store.markDefault(id));
      },
    );
  }
}
