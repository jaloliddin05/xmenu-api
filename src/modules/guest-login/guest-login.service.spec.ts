import { Logger } from '@nestjs/common';
import { GuestLoginService } from './guest-login.service';
import { smsLoginAvailable } from './guest-login';

const ORG = 'org-1';

function setup(o: {
  sms: boolean;
  bot: boolean;
  live: { delivery_enabled: boolean; published_at: Date | null } | null;
}) {
  const keys = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string) => {
      if (keys.has(key)) return null;
      keys.add(key);
      return 'OK';
    }),
  };
  const ops = { alert: jest.fn(async () => undefined) };
  const prisma = {
    organization: { findUnique: jest.fn(async () => o.live) },
  };
  const bots = { usable: jest.fn(async () => o.bot) };
  if (o.sms) process.env.SMS_PROVIDER = 'console';
  else {
    process.env.SMS_PROVIDER = 'eskiz';
    delete process.env.ESKIZ_EMAIL;
    delete process.env.ESKIZ_PASSWORD;
  }
  const svc = new GuestLoginService(
    prisma as any,
    bots as any,
    ops as any,
    redis as any,
  );
  return { svc, ops, redis, prisma, keys };
}

const LIVE = { delivery_enabled: true, published_at: new Date() };

describe('GuestLoginService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.OTP_DEV_MODE;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('sms %s, venue bot usable %s: reported as is', async (sms, bot) => {
    const { svc } = setup({ sms, bot, live: null });
    expect(await svc.methods(ORG)).toEqual({ sms, telegram: bot });
  });

  it('a published venue without any method: log and ops chat once an hour per venue', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { svc, ops, redis, keys } = setup({
      sms: false,
      bot: false,
      live: LIVE,
    });
    await svc.methods(ORG);
    await svc.methods(ORG);
    await svc.methods(ORG, true);
    expect(ops.alert).toHaveBeenCalledTimes(1);
    expect(ops.alert.mock.calls[0]).toEqual([expect.stringContaining(ORG)]);
    expect(redis.set).toHaveBeenCalledWith(
      `ops:guest-login-unavailable:${ORG}`,
      '1',
      'EX',
      3600,
      'NX',
    );
    // The hour is over (the key expired): reported again
    keys.clear();
    await svc.methods(ORG);
    expect(ops.alert).toHaveBeenCalledTimes(2);
    // Another venue has its own hour
    await svc.methods('org-2');
    expect(ops.alert).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it.each([
    ['not published', { delivery_enabled: true, published_at: null }],
    ['ordering off', { delivery_enabled: false, published_at: null }],
    ['venue gone', null],
  ])('%s: no alert', async (_name, live) => {
    const { svc, ops, redis } = setup({ sms: false, bot: false, live });
    await svc.methods(ORG);
    expect(ops.alert).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('a caller that knows the venue is not live saves the lookup', async () => {
    const { svc, ops, prisma } = setup({ sms: false, bot: false, live: LIVE });
    await svc.methods(ORG, false);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(ops.alert).not.toHaveBeenCalled();
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    'sms %s, bot %s on a published venue: a method works, no alert',
    async (sms, bot) => {
      const { svc, ops, prisma } = setup({ sms, bot, live: LIVE });
      await svc.methods(ORG);
      expect(ops.alert).not.toHaveBeenCalled();
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    },
  );

  it('a failing ops chat or Redis does not fail the answer', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { svc, ops, redis } = setup({ sms: false, bot: false, live: LIVE });
    ops.alert.mockRejectedValueOnce(new Error('telegram down'));
    await expect(svc.methods(ORG)).resolves.toEqual({
      sms: false,
      telegram: false,
    });
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.methods('org-2')).resolves.toEqual({
      sms: false,
      telegram: false,
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('smsLoginAvailable', () => {
  it('follows the provider credentials, and OTP_DEV_MODE like otp/request', () => {
    expect(smsLoginAvailable({ SMS_PROVIDER: 'eskiz' })).toBe(false);
    expect(
      smsLoginAvailable({ SMS_PROVIDER: 'eskiz', OTP_DEV_MODE: 'true' }),
    ).toBe(true);
    expect(smsLoginAvailable({ SMS_PROVIDER: 'console' })).toBe(true);
  });
});
