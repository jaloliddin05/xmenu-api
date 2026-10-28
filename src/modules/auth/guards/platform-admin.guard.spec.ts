import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

const ctx = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();
  afterEach(() => delete process.env.PLATFORM_ADMIN_USER_IDS);

  it('denies everyone when the list is unset or empty', () => {
    expect(() => guard.canActivate(ctx({ id: 'u1' }))).toThrow(ForbiddenException);
    process.env.PLATFORM_ADMIN_USER_IDS = ' , ';
    expect(() => guard.canActivate(ctx({ id: '' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ id: 'u1' }))).toThrow(ForbiddenException);
  });

  it('denies an ordinary owner', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    expect(() => guard.canActivate(ctx({ id: 'owner-9' }))).toThrow(ForbiddenException);
  });

  it('allows listed ids, tolerating spaces in the list', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'a, admin-1 ,b';
    expect(guard.canActivate(ctx({ id: 'admin-1' }))).toBe(true);
  });

  it('is exact: no prefix, case or missing user bypass', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'admin-1';
    for (const user of [{ id: 'admin' }, { id: 'ADMIN-1' }, { id: 'admin-12' }, {}, undefined, { id: ['admin-1'] }]) {
      expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
    }
  });
});
