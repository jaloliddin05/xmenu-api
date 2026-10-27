import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { CustomerAccessTokenGuard } from 'src/modules/auth/passport-strategies/customer-access-token/customer-access-token.guard';
import { TenantGuard } from 'src/modules/tenant/tenant.guard';
import { CustomerAddressController } from './customer-address.controller';
import {
  AddressView,
  CustomerAddressService,
} from './services/customer-address.service';

const PRINCIPAL = { customerId: 'cust-1', tenantId: 'tenant-1', sid: 'sid-1' };
const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

const VIEW: AddressView = {
  id: ID,
  title: 'Uy',
  address: 'Shamol oti 42',
  latitude: 41.311081,
  longitude: 69.240562,
  entrance: null,
  floor: null,
  apartment: null,
  comment: null,
  isDefault: true,
  createdAt: '2026-10-07T10:00:00.000Z',
};

/** Haqiqiy guardlar JWT/DB talab qiladi; bu test routing, validatsiya va javob formatini tekshiradi. */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest<{ user: unknown }>().user = PRINCIPAL;
    return true;
  }
}

interface ErrorBody {
  error: { code: string; message: string };
}

describe('CustomerAddressController (HTTP)', () => {
  let app: INestApplication;
  // getHttpServer() any qaytaradi; supertest kutgan turga aniq o'tkazamiz.
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerAddressController],
      providers: [{ provide: CustomerAddressService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useClass(FakeAuthGuard)
      .overrideGuard(CustomerAccessTokenGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts dagi bilan bir xil sozlama.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  describe('GET /customers/me/addresses', () => {
    it('returns the list for the customer and tenant taken from the token', async () => {
      service.list.mockResolvedValue([VIEW]);

      const res = await request(http())
        .get('/customers/me/addresses')
        .expect(200);

      expect(res.body).toEqual([VIEW]);
      expect(service.list).toHaveBeenCalledWith(
        PRINCIPAL.tenantId,
        PRINCIPAL.customerId,
      );
    });
  });

  describe('POST /customers/me/addresses', () => {
    it('creates with 201 and returns the saved address', async () => {
      service.create.mockResolvedValue(VIEW);
      const body = {
        title: 'Uy',
        address: 'Shamol oti 42',
        latitude: 41.311081,
        longitude: 69.240562,
        entrance: '2',
        floor: '5',
        apartment: '17',
        comment: "Darvoza ko'k",
        isDefault: true,
      };

      const res = await request(http())
        .post('/customers/me/addresses')
        .send(body)
        .expect(201);

      expect(res.body).toEqual(VIEW);
      expect(service.create).toHaveBeenCalledWith(
        PRINCIPAL.tenantId,
        PRINCIPAL.customerId,
        body,
      );
    });

    it('accepts a minimal body and explicit nulls for the optional fields', async () => {
      service.create.mockResolvedValue(VIEW);

      await request(http())
        .post('/customers/me/addresses')
        .send({
          address: 'Shamol oti 42',
          title: null,
          latitude: null,
          longitude: null,
          comment: null,
        })
        .expect(201);
    });

    it.each([
      ['a missing address', { title: 'Uy' }],
      ['a non-string address', { address: 42 }],
      [
        'a string latitude',
        { address: 'Shamol oti 42', latitude: '41.3', longitude: 69.2 },
      ],
      [
        'a latitude out of range',
        { address: 'Shamol oti 42', latitude: 411.3, longitude: 69.2 },
      ],
      [
        'a non-boolean isDefault',
        { address: 'Shamol oti 42', isDefault: 'yes' },
      ],
      [
        'an unknown field',
        { address: 'Shamol oti 42', customer_id: 'someone-else' },
      ],
    ])(
      'rejects %s with 400 validation_error and never reaches the service',
      async (_label, body) => {
        const res = await request(http())
          .post('/customers/me/addresses')
          .send(body)
          .expect(400);

        expect((res.body as ErrorBody).error.code).toBe('validation_error');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(service.create).not.toHaveBeenCalled();
      },
    );

    it('cannot be pointed at another customer: ids in the body are refused, not trusted', async () => {
      await request(http())
        .post('/customers/me/addresses')
        .send({
          address: 'Shamol oti 42',
          customerId: 'someone-else',
          tenantId: 'other-tenant',
        })
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
    });

    it.each([
      ['invalid_address', 400],
      ['address_limit_reached', 409],
      ['customer_blocked', 403],
      ['invalid_token', 401],
    ] as const)(
      'maps the service error %s to HTTP %i in the customer error format',
      async (code, status) => {
        service.create.mockRejectedValue(
          new CustomerAuthException(code, 'detail'),
        );

        const res = await request(http())
          .post('/customers/me/addresses')
          .send({ address: 'Shamol oti 42' });

        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error: { code, message: 'detail' } });
      },
    );
  });

  describe('POST /customers/me/addresses/:id/default', () => {
    it('answers 200 with the updated address', async () => {
      service.setDefault.mockResolvedValue(VIEW);

      const res = await request(http())
        .post(`/customers/me/addresses/${ID}/default`)
        .expect(200);

      expect(res.body).toEqual(VIEW);
      expect(service.setDefault).toHaveBeenCalledWith(
        PRINCIPAL.tenantId,
        PRINCIPAL.customerId,
        ID,
      );
    });

    it('answers 404 address_not_found for an address that is not the customer’s', async () => {
      service.setDefault.mockRejectedValue(
        new CustomerAuthException('address_not_found'),
      );

      const res = await request(http())
        .post(`/customers/me/addresses/${ID}/default`)
        .expect(404);

      expect((res.body as ErrorBody).error.code).toBe('address_not_found');
    });

    it('answers 400 for an id that is not a UUID', async () => {
      const res = await request(http())
        .post('/customers/me/addresses/not-a-uuid/default')
        .expect(400);

      expect((res.body as ErrorBody).error.code).toBe('validation_error');
      expect(service.setDefault).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /customers/me/addresses/:id', () => {
    it('answers 204 with an empty body', async () => {
      service.remove.mockResolvedValue(undefined);

      const res = await request(http())
        .delete(`/customers/me/addresses/${ID}`)
        .expect(204);

      expect(res.text).toBe('');
      expect(service.remove).toHaveBeenCalledWith(
        PRINCIPAL.tenantId,
        PRINCIPAL.customerId,
        ID,
      );
    });

    it('answers 404 address_not_found when there is nothing to delete', async () => {
      service.remove.mockRejectedValue(
        new CustomerAuthException('address_not_found'),
      );

      const res = await request(http())
        .delete(`/customers/me/addresses/${ID}`)
        .expect(404);

      expect(res.body).toEqual({
        error: { code: 'address_not_found', message: 'address_not_found' },
      });
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await request(http()).delete('/customers/me/addresses/123').expect(400);
      expect(service.remove).not.toHaveBeenCalled();
    });
  });
});
