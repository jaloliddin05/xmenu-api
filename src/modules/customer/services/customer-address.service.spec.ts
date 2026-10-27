import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import {
  AddressRecord,
  AddressStore,
  CustomerAddressRepository,
  NewAddressRecord,
} from '../repositories/customer-address.repository';
import {
  CustomerAddressService,
  MAX_ADDRESSES_PER_CUSTOMER,
} from './customer-address.service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const ALICE = 'customer-alice';
const BOB = 'customer-bob';

/**
 * Xotiradagi repository. Bazaning haqiqiy qoidalarini ataylab takrorlaydi,
 * shunda servis ularni buzsa test yiqiladi:
 *  - mijoz tenantga tegishli (boshqa tenant => invalid_token);
 *  - bitta mijozda bittadan ortiq is_default=true bo'lsa — partial unique
 *    index kabi xato beradi;
 *  - withCustomerLock bir mijoz uchun chaqiruvlarni NAVBAT bilan bajaradi
 *    (FOR UPDATE ning o'rni).
 * SQL ning o'zi bu yerda tekshirilmaydi — u faqat haqiqiy Postgres'da
 * sinaladi.
 */
class FakeAddressRepository {
  private rows: (AddressRecord & { customer_id: string })[] = [];
  private seq = 0;
  private locks = new Map<string, Promise<unknown>>();

  customers = new Map<
    string,
    { tenantId: string; status: 'active' | 'blocked' }
  >([
    [ALICE, { tenantId: TENANT, status: 'active' }],
    [BOB, { tenantId: TENANT, status: 'active' }],
  ]);

  list(tenantId: string, customerId: string): Promise<AddressRecord[]> {
    if (this.customers.get(customerId)?.tenantId !== tenantId)
      return Promise.resolve([]);
    const mine = this.rows.filter((r) => r.customer_id === customerId);
    mine.sort(
      (a, b) =>
        Number(b.is_default) - Number(a.is_default) ||
        b.created_at.getTime() - a.created_at.getTime() ||
        a.id.localeCompare(b.id),
    );
    return Promise.resolve(mine.map(stripOwner));
  }

  withCustomerLock<T>(
    tenantId: string,
    customerId: string,
    fn: (store: AddressStore) => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(customerId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const customer = this.customers.get(customerId);
      if (!customer || customer.tenantId !== tenantId)
        throw new CustomerAuthException('invalid_token');
      if (customer.status === 'blocked')
        throw new CustomerAuthException('customer_blocked');
      return fn(this.storeFor(customerId));
    });
    this.locks.set(
      customerId,
      run.catch(() => undefined),
    );
    return run;
  }

  all(customerId: string) {
    return this.rows.filter((r) => r.customer_id === customerId);
  }

  private assertOneDefault(customerId: string) {
    if (
      this.rows.filter((r) => r.customer_id === customerId && r.is_default)
        .length > 1
    ) {
      throw new Error(
        'unique violation: customer_address_customer_id_default_key',
      );
    }
  }

  private storeFor(customerId: string): AddressStore {
    const mine = () => this.rows.filter((r) => r.customer_id === customerId);
    return {
      count: () => Promise.resolve(mine().length),
      findById: (id) =>
        Promise.resolve(stripOwnerOrNull(mine().find((r) => r.id === id))),
      findNewest: () => {
        const sorted = [...mine()].sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime(),
        );
        return Promise.resolve(stripOwnerOrNull(sorted[0]));
      },
      insert: (data: NewAddressRecord) => {
        this.seq += 1;
        const row = {
          ...data,
          id: `addr-${this.seq}`,
          customer_id: customerId,
          created_at: new Date(Date.UTC(2026, 0, 1) + this.seq * 1000),
        };
        this.rows.push(row);
        this.assertOneDefault(customerId);
        return Promise.resolve(stripOwner(row));
      },
      delete: (id) => {
        this.rows = this.rows.filter(
          (r) => !(r.id === id && r.customer_id === customerId),
        );
        return Promise.resolve();
      },
      clearDefault: () => {
        mine().forEach((r) => (r.is_default = false));
        return Promise.resolve();
      },
      markDefault: (id) => {
        const row = mine().find((r) => r.id === id);
        if (!row) throw new Error('row vanished');
        row.is_default = true;
        this.assertOneDefault(customerId);
        return Promise.resolve(stripOwner(row));
      },
    };
  }
}

function stripOwner(
  row: AddressRecord & { customer_id: string },
): AddressRecord {
  const copy: Partial<typeof row> = { ...row };
  delete copy.customer_id;
  return copy as AddressRecord;
}
function stripOwnerOrNull(
  row?: AddressRecord & { customer_id: string },
): AddressRecord | null {
  return row ? stripOwner(row) : null;
}

const dto = (over: Record<string, unknown> = {}) => ({
  address: 'Shamol oti ko‘chasi 42',
  ...over,
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CustomerAuthException) return err.code;
    throw err;
  }
  throw new Error('expected the promise to reject');
}

describe('CustomerAddressService', () => {
  let repo: FakeAddressRepository;
  let service: CustomerAddressService;

  beforeEach(() => {
    repo = new FakeAddressRepository();
    service = new CustomerAddressService(
      repo as unknown as CustomerAddressRepository,
    );
  });

  describe('create', () => {
    it('makes the first address the default, even if the caller did not ask for it', async () => {
      const created = await service.create(
        TENANT,
        ALICE,
        dto({ isDefault: false }),
      );
      expect(created.isDefault).toBe(true);
    });

    it('leaves later addresses non-default unless asked', async () => {
      await service.create(TENANT, ALICE, dto());
      const second = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'Amir Temur 1' }),
      );
      expect(second.isDefault).toBe(false);
      expect(
        (await service.list(TENANT, ALICE)).filter((a) => a.isDefault),
      ).toHaveLength(1);
    });

    it('moves the default when a later address asks for it, leaving exactly one', async () => {
      const first = await service.create(TENANT, ALICE, dto());
      const second = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'Amir Temur 1', isDefault: true }),
      );

      const list = await service.list(TENANT, ALICE);
      expect(second.isDefault).toBe(true);
      expect(list.find((a) => a.id === first.id)?.isDefault).toBe(false);
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    });

    it('stores the cleaned values and returns the camelCase view', async () => {
      const created = await service.create(
        TENANT,
        ALICE,
        dto({
          title: '  Uy ',
          address: '  Shamol   oti 42 ',
          latitude: 41.31108123456,
          longitude: 69.240562,
          entrance: ' 2 ',
          floor: '5',
          apartment: '',
          comment: 'Darvoza\r\nko‘k',
        }),
      );

      const { id, createdAt, ...stored } = created;
      expect(stored).toEqual({
        title: 'Uy',
        address: 'Shamol oti 42',
        latitude: 41.311081,
        longitude: 69.240562,
        entrance: '2',
        floor: '5',
        apartment: null,
        comment: 'Darvoza\nko‘k',
        isDefault: true,
      });
      expect(typeof id).toBe('string');
      expect(createdAt).toMatch(/^2026-01-01T00:00:\d\d\.000Z$/);
    });

    it('rejects invalid input as invalid_address and stores nothing', async () => {
      expect(
        await codeOf(service.create(TENANT, ALICE, dto({ address: 'x' }))),
      ).toBe('invalid_address');
      expect(
        await codeOf(service.create(TENANT, ALICE, dto({ latitude: 41.3 }))),
      ).toBe('invalid_address');
      expect(repo.all(ALICE)).toHaveLength(0);
    });

    it(`stops at ${MAX_ADDRESSES_PER_CUSTOMER} addresses with address_limit_reached`, async () => {
      for (let i = 0; i < MAX_ADDRESSES_PER_CUSTOMER; i += 1) {
        await service.create(
          TENANT,
          ALICE,
          dto({ address: `Ko‘cha ${i + 1}` }),
        );
      }
      expect(
        await codeOf(
          service.create(TENANT, ALICE, dto({ address: 'Ortiqcha' })),
        ),
      ).toBe('address_limit_reached');
      expect(repo.all(ALICE)).toHaveLength(MAX_ADDRESSES_PER_CUSTOMER);
    });

    it('keeps the limit and the single-default invariant when saves arrive in parallel', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: MAX_ADDRESSES_PER_CUSTOMER + 5 }, (_v, i) =>
          service.create(
            TENANT,
            ALICE,
            dto({ address: `Ko‘cha ${i + 1}`, isDefault: i % 2 === 0 }),
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(MAX_ADDRESSES_PER_CUSTOMER);
      expect(rejected).toHaveLength(5);
      expect(
        rejected.every(
          (r) =>
            (r.reason as CustomerAuthException).code ===
            'address_limit_reached',
        ),
      ).toBe(true);
      expect(repo.all(ALICE).filter((r) => r.is_default)).toHaveLength(1);
    });

    it('does not count one customer’s addresses against another', async () => {
      for (let i = 0; i < MAX_ADDRESSES_PER_CUSTOMER; i += 1) {
        await service.create(
          TENANT,
          ALICE,
          dto({ address: `Ko‘cha ${i + 1}` }),
        );
      }
      await expect(service.create(TENANT, BOB, dto())).resolves.toMatchObject({
        isDefault: true,
      });
    });
  });

  describe('list', () => {
    it('returns the default first, then newest to oldest', async () => {
      const a = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'A ko‘cha' }),
      );
      const b = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'B ko‘cha' }),
      );
      const c = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'C ko‘cha' }),
      );

      expect((await service.list(TENANT, ALICE)).map((x) => x.id)).toEqual([
        a.id,
        c.id,
        b.id,
      ]);
    });

    it('is empty for a customer with no addresses', async () => {
      expect(await service.list(TENANT, BOB)).toEqual([]);
    });
  });

  describe('remove', () => {
    it('deletes a non-default address and leaves the default alone', async () => {
      const first = await service.create(TENANT, ALICE, dto());
      const second = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'Amir Temur 1' }),
      );

      await service.remove(TENANT, ALICE, second.id);

      const list = await service.list(TENANT, ALICE);
      expect(list.map((a) => a.id)).toEqual([first.id]);
      expect(list[0].isDefault).toBe(true);
    });

    it('promotes the newest remaining address when the default is deleted', async () => {
      const first = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'A ko‘cha' }),
      );
      await service.create(TENANT, ALICE, dto({ address: 'B ko‘cha' }));
      const newest = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'C ko‘cha' }),
      );

      await service.remove(TENANT, ALICE, first.id);

      const list = await service.list(TENANT, ALICE);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(newest.id);
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
      expect(list[0].isDefault).toBe(true);
    });

    it('leaves nothing behind when the last address is deleted', async () => {
      const only = await service.create(TENANT, ALICE, dto());
      await service.remove(TENANT, ALICE, only.id);
      expect(await service.list(TENANT, ALICE)).toEqual([]);
    });

    it('treats an unknown id as address_not_found', async () => {
      expect(await codeOf(service.remove(TENANT, ALICE, 'nope'))).toBe(
        'address_not_found',
      );
    });

    it('does not let one customer delete another’s address, and does not reveal that it exists', async () => {
      const bobs = await service.create(TENANT, BOB, dto());

      expect(await codeOf(service.remove(TENANT, ALICE, bobs.id))).toBe(
        'address_not_found',
      );
      expect(await service.list(TENANT, BOB)).toHaveLength(1);
    });

    it('answers address_not_found the second time (the frontend treats that as already deleted)', async () => {
      const only = await service.create(TENANT, ALICE, dto());
      await service.remove(TENANT, ALICE, only.id);
      expect(await codeOf(service.remove(TENANT, ALICE, only.id))).toBe(
        'address_not_found',
      );
    });
  });

  describe('setDefault', () => {
    it('switches the default and leaves exactly one', async () => {
      const first = await service.create(TENANT, ALICE, dto());
      const second = await service.create(
        TENANT,
        ALICE,
        dto({ address: 'Amir Temur 1' }),
      );

      const result = await service.setDefault(TENANT, ALICE, second.id);

      expect(result).toMatchObject({ id: second.id, isDefault: true });
      const list = await service.list(TENANT, ALICE);
      expect(list.find((a) => a.id === first.id)?.isDefault).toBe(false);
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    });

    it('is idempotent for an address that is already the default', async () => {
      const first = await service.create(TENANT, ALICE, dto());
      await expect(
        service.setDefault(TENANT, ALICE, first.id),
      ).resolves.toMatchObject({ isDefault: true });
    });

    it('rejects an unknown or foreign id', async () => {
      const bobs = await service.create(TENANT, BOB, dto());
      expect(await codeOf(service.setDefault(TENANT, ALICE, 'nope'))).toBe(
        'address_not_found',
      );
      expect(await codeOf(service.setDefault(TENANT, ALICE, bobs.id))).toBe(
        'address_not_found',
      );
    });
  });

  describe('tenant and account state', () => {
    it('refuses a token whose customer belongs to another tenant and returns nothing from list', async () => {
      await service.create(TENANT, ALICE, dto());

      expect(await service.list(OTHER_TENANT, ALICE)).toEqual([]);
      expect(await codeOf(service.create(OTHER_TENANT, ALICE, dto()))).toBe(
        'invalid_token',
      );
      expect(await codeOf(service.remove(OTHER_TENANT, ALICE, 'addr-1'))).toBe(
        'invalid_token',
      );
      expect(
        await codeOf(service.setDefault(OTHER_TENANT, ALICE, 'addr-1')),
      ).toBe('invalid_token');
      expect(repo.all(ALICE)).toHaveLength(1);
    });

    it('refuses writes for a deleted/unknown customer', async () => {
      expect(await codeOf(service.create(TENANT, 'ghost', dto()))).toBe(
        'invalid_token',
      );
    });

    it('refuses writes for a blocked customer', async () => {
      repo.customers.set(ALICE, { tenantId: TENANT, status: 'blocked' });
      expect(await codeOf(service.create(TENANT, ALICE, dto()))).toBe(
        'customer_blocked',
      );
    });
  });
});
