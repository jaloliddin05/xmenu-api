import { ExecutionContext } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AppModule } from 'src/app.module';
import { collectRoutes } from 'src/modules/auth/access/route-rules';
import { PUBLIC_KEY } from 'src/modules/auth/decorators/public.decorator';
import { LiveMutationInterceptor } from './live-mutation.interceptor';
import { MUTATING_METHODS, resourceOf } from './live-resources';

describe('live resources', () => {
  it('every staff route that changes data names what it touches (a new one fails here)', async () => {
    const preview = await NestFactory.create(AppModule, {
      preview: true,
      logger: false,
    });
    const routes = collectRoutes(preview);
    await preview.close();
    const missing = routes
      .filter(
        (r) =>
          MUTATING_METHODS.includes(r.method) &&
          r.rule !== 'public' &&
          resourceOf(r.path) === undefined,
      )
      .map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  }, 60_000);

  it('reads the first segment of the route path', () => {
    expect(resourceOf('/organization/:id/settings')).toBe('venue');
    expect(resourceOf('/product/:id')).toBe('menu');
    expect(resourceOf('/auth/logout')).toBeNull();
    expect(resourceOf('/nothing-like-this')).toBeUndefined();
  });
});

describe('LiveMutationInterceptor', () => {
  const bus = { orgChanged: jest.fn(() => Promise.resolve()) };
  const reflector = new Reflector();
  const revalidate = { addRevalidationJob: jest.fn(() => Promise.resolve()) };
  const interceptor = new LiveMutationInterceptor(
    reflector,
    bus as never,
    revalidate,
  );
  const handler = () => undefined;
  const publicHandler = () => undefined;
  Reflect.defineMetadata(PUBLIC_KEY, true, publicHandler);

  const ctx = (
    method: string,
    path: string,
    opts: { handler?: () => void; origin?: string; org?: string | null } = {},
  ) => {
    const req = {
      method,
      route: { path },
      user:
        opts.org === null
          ? undefined
          : { organization: { id: opts.org ?? 'org-1' } },
      header: (name: string) =>
        name === 'x-live-origin' ? opts.origin : undefined,
    };
    return {
      getType: () => 'http',
      getHandler: () => opts.handler ?? handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    bus.orgChanged.mockClear();
    revalidate.addRevalidationJob.mockClear();
  });

  it('after a successful staff change: org.changed with the resource and the tab', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx('PUT', '/product/:id', { origin: 'tab-1' }), {
        handle: () => of({ ok: true }),
      }),
    );
    expect(bus.orgChanged).toHaveBeenCalledWith('org-1', ['menu'], 'tab-1');
    // what guests see is refreshed too, even when the service forgot it
    expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
      tenantId: 'org-1',
      route: 'menu',
    });
  });

  it('a change guests do not see refreshes no guest page', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx('POST', '/order/:id/accept'), {
        handle: () => of({}),
      }),
    );
    expect(bus.orgChanged).toHaveBeenCalledWith('org-1', ['orders'], null);
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });

  it('nothing for a failed change, a read, a public route or a route of no screen', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx('POST', '/product'), {
          handle: () => throwError(() => new Error('400')),
        }),
      ),
    ).rejects.toThrow();
    await lastValueFrom(
      interceptor.intercept(ctx('GET', '/product'), { handle: () => of([]) }),
    );
    await lastValueFrom(
      interceptor.intercept(
        ctx('POST', '/orders', { handler: publicHandler }),
        {
          handle: () => of({}),
        },
      ),
    );
    await lastValueFrom(
      interceptor.intercept(ctx('POST', '/auth/logout'), {
        handle: () => of({}),
      }),
    );
    expect(bus.orgChanged).not.toHaveBeenCalled();
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });
});
