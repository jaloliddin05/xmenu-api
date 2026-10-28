import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
  const ctx = (headers: Record<string, unknown>) => {
    const req: any = { headers };
    return {
      req,
      context: { switchToHttp: () => ({ getRequest: () => req }) } as any,
    };
  };

  it('requires X-Tenant-Id', async () => {
    const guard = new TenantGuard({ resolve: jest.fn() } as any);
    const { context } = ctx({});
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'tenant_required',
    });
    await expect(
      guard.canActivate(ctx({ 'x-tenant-id': '  ' }).context),
    ).rejects.toBeInstanceOf(CustomerAuthException);
  });

  it('puts the resolved tenant on the request', async () => {
    const tenant = { id: 't', slug: 's', brandName: 'B' };
    const resolve = jest.fn(async () => tenant);
    const guard = new TenantGuard({ resolve } as any);
    const { req, context } = ctx({ 'x-tenant-id': ' some-id ' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('some-id');
    expect(req.tenant).toBe(tenant);
  });
});
