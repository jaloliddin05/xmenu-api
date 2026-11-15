import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import type { FakeStaffUser } from 'src/infra/testing/http-app.fake';
import { roleCan } from './permissions';
import { collectRoutes } from './route-rules';
import type { RouteInfo } from './route-rules';
import type { StaffAccessRule } from './staff-access.decorator';

/**
 * The access matrix: every route of the application with its explicit rule. `public` routes skip the
 * staff guards (customer and webhook routes have their own); every other route names the permission it
 * needs (auth/access/permissions.ts), `@param` when the path carries the caller's organization id.
 * A new route fails this spec until it gets a StaffAccess rule (or @Public) and a line here.
 */
const EXPECTED: Record<string, string> = {
  'POST /additional-product': 'venue',
  'DELETE /additional-product/:id': 'venue',
  'PUT /additional-product/:id': 'venue',
  'POST /additional-product/group': 'venue',
  'DELETE /additional-product/group/:id': 'venue',
  'PUT /additional-product/group/:id': 'venue',
  'GET /application': 'platform-admin',
  'POST /application': 'public',
  'POST /auth/check-code': 'public',
  'POST /auth/customer/login': 'public',
  'POST /auth/customer/logout': 'public',
  'GET /auth/customer/me': 'public',
  'GET /auth/customer/methods': 'public',
  'POST /auth/customer/otp/request': 'public',
  'POST /auth/customer/otp/verify': 'public',
  'POST /auth/customer/refresh': 'public',
  'POST /auth/customer/register': 'public',
  'POST /auth/customer/telegram/start': 'public',
  'POST /auth/customer/telegram/status': 'public',
  'POST /auth/invitation/accept': 'public',
  'POST /auth/invitation/code': 'public',
  'POST /auth/login': 'public',
  'POST /auth/logout': 'public',
  'POST /auth/password/change': 'account',
  'POST /auth/password/forgot': 'public',
  'POST /auth/password/reset': 'public',
  'POST /auth/refresh': 'public',
  'POST /auth/register': 'public',
  'POST /auth/resend-code': 'public',
  'DELETE /auth/sessions': 'account',
  'GET /auth/sessions': 'account',
  'DELETE /auth/sessions/:id': 'account',
  'GET /branch': 'branches.read',
  'POST /branch': 'venue',
  'DELETE /branch/:id': 'venue',
  'PATCH /branch/:id': 'venue',
  'POST /branch/:id/exceptions': 'venue',
  'DELETE /branch/:id/exceptions/:exceptionId': 'venue',
  'PUT /branch/:id/working-hours': 'venue',
  'GET /branches': 'public',
  'GET /category': 'menu.read',
  'POST /category': 'venue',
  'DELETE /category/:id': 'venue',
  'GET /category/:id': 'menu.read',
  'PUT /category/:id': 'venue',
  'PATCH /category/:id/activate': 'venue',
  'GET /category/for-select/:organizationId': 'menu.read@organizationId',
  'PATCH /category/index': 'venue',
  'GET /checkout-config': 'public',
  'GET /customers/me': 'public',
  'PATCH /customers/me': 'public',
  'GET /customers/me/addresses': 'public',
  'POST /customers/me/addresses': 'public',
  'DELETE /customers/me/addresses/:id': 'public',
  'POST /customers/me/addresses/:id/default': 'public',
  'POST /file/upload': 'profile',
  'GET /menu': 'public',
  'GET /order': 'orders',
  'GET /order-settings': 'venue',
  'PUT /order-settings': 'venue',
  'GET /order/:id': 'orders',
  'POST /order/:id/accept': 'orders',
  'POST /order/:id/advance': 'orders',
  'POST /order/:id/reject': 'orders',
  'POST /order/:id/status': 'orders',
  'GET /orders': 'public',
  'POST /orders': 'public',
  'GET /orders/:id': 'public',
  'POST /orders/:id/cancel': 'public',
  'POST /orders/:id/payment/retry': 'public',
  'DELETE /organization/:id': 'venue@id',
  'GET /organization/:id': 'venue@id',
  'PUT /organization/:id': 'venue@id',
  'PUT /organization/:id/channels': 'venue@id',
  'GET /organization/:id/domains': 'venue@id',
  'POST /organization/:id/domains': 'venue@id',
  'DELETE /organization/:id/domains/:domainId': 'venue@id',
  'POST /organization/:id/domains/:domainId/verify': 'venue@id',
  'GET /organization/:id/publication': 'venue@id',
  'POST /organization/:id/publish': 'venue@id',
  'GET /organization/:id/settings': 'venue@id',
  'PUT /organization/:id/settings': 'venue@id',
  'GET /organization/:id/staff': 'staff@id',
  'POST /organization/:id/staff': 'staff@id',
  'POST /organization/:id/staff/:memberId/disable': 'staff@id',
  'POST /organization/:id/unpublish': 'venue@id',
  'POST /organization/check-slug': 'venue',
  'GET /organization/return-slug/:id': 'public',
  'GET /payment-provider': 'venue',
  'PUT /payment-provider/:provider': 'venue',
  'POST /payment-provider/:provider/disable': 'venue',
  'POST /payments/click/:tenantId/complete': 'public',
  'POST /payments/click/:tenantId/prepare': 'public',
  'POST /payments/payme/:tenantId': 'public',
  'GET /product': 'menu.read',
  'POST /product': 'venue',
  'DELETE /product/:id': 'venue',
  'GET /product/:id': 'menu.read',
  'PUT /product/:id': 'venue',
  'PATCH /product/:id/activate': 'venue',
  'PATCH /product/:id/images': 'venue',
  'DELETE /product/image/:id': 'venue',
  'PATCH /product/index': 'venue',
  'DELETE /telegram-bot': 'venue',
  'GET /telegram-bot': 'venue',
  'PUT /telegram-bot': 'venue',
  'PUT /telegram-bot/profile': 'venue',
  'POST /telegram-bot/sync': 'venue',
  'POST /telegram/bot/:botKey/webhook': 'public',
  'POST /telegram/orders/webhook': 'public',
  'GET /tenant/by-host/:host': 'public',
  'GET /tenant/by-slug/:slug': 'public',
  'GET /tenant/config': 'public',
  'POST /translation': 'venue',
  'DELETE /user/:id': 'venue',
  'PUT /user/:id': 'profile',
  'GET /user/me': 'account',
};

const key = (r: RouteInfo) => `${r.method} ${r.path}`;
const describeRule = (rule: RouteInfo['rule']) =>
  rule === 'public'
    ? 'public'
    : rule === null
      ? 'NO RULE'
      : rule.permission + (rule.orgParam ? `@${rule.orgParam}` : '');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ANY_ID = '33333333-3333-4333-8333-333333333333';

const USERS: FakeStaffUser[] = [
  { id: 'owner', role: 'owner', organization: { id: ORG, slug: 'mant' } },
  { id: 'operator', role: 'operator', organization: { id: ORG, slug: 'mant' } },
  // Disabled by the owner: the account is switched off together with the membership
  {
    id: 'disabled',
    isActive: false,
    role: null,
    organization: { id: ORG, slug: 'mant' },
  },
  {
    id: 'foreign',
    role: 'owner',
    organization: { id: OTHER_ORG, slug: 'other' },
  },
];

/** Every provider the controllers need: functions that resolve to an empty object, calls recorded. */
const calls: unknown[][] = [];
function autoMock(): unknown {
  const fns = new Map<PropertyKey, jest.Mock>();
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        if (!fns.has(prop))
          fns.set(
            prop,
            jest.fn((...args: unknown[]) => {
              calls.push(args);
              return Promise.resolve({});
            }),
          );
        return fns.get(prop);
      },
    },
  );
}

describe('staff access matrix', () => {
  let routes: RouteInfo[];

  beforeAll(async () => {
    // Same module graph as main.ts, without Postgres or Redis
    const preview = await NestFactory.create(AppModule, {
      preview: true,
      logger: false,
    });
    routes = collectRoutes(preview);
    await preview.close();
  }, 60_000);

  it('every route has an explicit rule, and it is the one listed here', () => {
    const actual = Object.fromEntries(
      routes.map((r) => [key(r), describeRule(r.rule)]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('every path with an organization id declares it, so another venue’s id is refused', () => {
    for (const r of routes) {
      if (r.rule === 'public' || r.rule === null) continue;
      const orgInPath =
        /^\/organization\/:id(\/|$)/.test(r.path) ||
        r.path.includes(':organizationId');
      expect([key(r), !!r.rule.orgParam]).toEqual([key(r), orgInPath]);
    }
  });

  describe('HTTP: every staff route for every kind of caller', () => {
    let app: INestApplication;
    let staff: (RouteInfo & { rule: StaffAccessRule })[];

    beforeAll(async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      staff = routes.filter(
        (r): r is RouteInfo & { rule: StaffAccessRule } =>
          r.rule !== 'public' && r.rule !== null,
      );
      const controllers = [...new Set(staff.map((r) => r.controller))];
      app = await createHttpApp({ controllers }, USERS, new Set(), () =>
        autoMock(),
      );
    }, 60_000);

    afterAll(() => app.close());

    beforeEach(() => {
      calls.length = 0;
    });

    const pathFor = (r: RouteInfo & { rule: StaffAccessRule }) =>
      r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) =>
        name === r.rule.orgParam ? ORG : ANY_ID,
      );

    const send = (r: RouteInfo & { rule: StaffAccessRule }, user?: string) => {
      const method = r.method.toLowerCase() as 'get';
      const req = request(app.getHttpServer())[method](pathFor(r));
      if (user) void req.set('Authorization', `Bearer ${staffToken(user)}`);
      return ['GET', 'DELETE'].includes(r.method) ? req : req.send({});
    };

    const label = (r: RouteInfo) => `${key(r)} [${describeRule(r.rule)}]`;

    it('without a token: 401 everywhere', async () => {
      for (const r of staff) {
        const res = await send(r);
        expect([label(r), res.status]).toEqual([label(r), 401]);
      }
      expect(calls).toHaveLength(0);
    });

    it('a disabled operator: 401 everywhere, nothing reached', async () => {
      for (const r of staff) {
        const res = await send(r, 'disabled');
        expect([label(r), res.status]).toEqual([label(r), 401]);
      }
      expect(calls).toHaveLength(0);
    });

    it.each(['owner', 'operator'] as const)(
      'the %s of the venue: allowed routes pass the guards, the rest are 403 before the handler',
      async (role) => {
        for (const r of staff) {
          calls.length = 0;
          const res = await send(r, role);
          const allowed =
            r.rule.permission !== 'platform-admin' &&
            roleCan(role, r.rule.permission);
          if (allowed) {
            expect([label(r), [401, 403].includes(res.status)]).toEqual([
              label(r),
              false,
            ]);
          } else {
            expect([label(r), res.status, res.body.code]).toEqual([
              label(r),
              403,
              'forbidden',
            ]);
            expect([label(r), calls.length]).toEqual([label(r), 0]);
          }
        }
      },
    );

    it('the owner of another venue: 404 on paths with this venue’s id, nothing reached; elsewhere scoped by the token', async () => {
      for (const r of staff) {
        calls.length = 0;
        const res = await send(r, 'foreign');
        if (r.rule.permission === 'platform-admin') {
          expect([label(r), res.status]).toEqual([label(r), 403]);
        } else if (r.rule.orgParam) {
          expect([label(r), res.status, res.body.code]).toEqual([
            label(r),
            404,
            'not_found',
          ]);
          expect([label(r), calls.length]).toEqual([label(r), 0]);
        } else {
          expect([label(r), [401, 403].includes(res.status)]).toEqual([
            label(r),
            false,
          ]);
          // The venue comes from the token: this venue's id never reaches a service
          expect([label(r), JSON.stringify(calls).includes(ORG)]).toEqual([
            label(r),
            false,
          ]);
        }
      }
    });
  });
});
