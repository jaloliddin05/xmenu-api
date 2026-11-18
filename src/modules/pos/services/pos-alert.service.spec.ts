import { FakeRedis } from 'src/infra/redis/redis.fake';
import { PosAlertService } from './pos-alert.service';

describe('PosAlertService', () => {
  let rows: Record<string, any>;
  let prisma: any;
  let restaurant: Record<string, jest.Mock>;
  let ops: { alert: jest.Mock };
  let redis: FakeRedis;
  let service: PosAlertService;

  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === 'OR') return cond.some((c: any) => matches(row, c));
      if (cond && typeof cond === 'object' && 'in' in cond)
        return cond.in.includes(row[key]);
      if (cond && typeof cond === 'object' && 'not' in cond)
        return row[key] !== null && row[key] !== cond.not;
      return row[key] === cond;
    });

  beforeEach(() => {
    rows = {
      a: { id: 'a', organization_id: 'org-a', status: 'active', alert: null },
      b: { id: 'b', organization_id: 'org-b', status: 'active', alert: null },
    };
    prisma = {
      pos_integration: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = Object.values(rows).filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
    };
    restaurant = {
      alertPosReconnect: jest.fn(async () => undefined),
      alertPosMenuImport: jest.fn(async () => undefined),
    };
    ops = { alert: jest.fn(async () => undefined) };
    redis = new FakeRedis();
    service = new PosAlertService(
      prisma,
      restaurant as any,
      ops as any,
      redis as any,
    );
  });

  it('one message per episode; the banner field is set; a cleared alert can be raised again', async () => {
    await service.raise(rows.a, 'menu_import_failed');
    await service.raise(rows.a, 'menu_import_failed');
    expect(restaurant.alertPosMenuImport).toHaveBeenCalledTimes(1);
    expect(restaurant.alertPosMenuImport).toHaveBeenCalledWith('org-a');
    expect(rows.a).toMatchObject({ alert: 'menu_import_failed' });
    expect(rows.a.alert_at).toBeInstanceOf(Date);

    await service.raise(rows.a, 'key_revoked');
    expect(restaurant.alertPosReconnect).toHaveBeenCalledWith('org-a');

    await service.clear('a', 'menu_import_failed');
    expect(rows.a.alert).toBe('key_revoked');
    await service.clear('a', 'key_revoked');
    expect(rows.a.alert).toBeNull();
    await service.raise(rows.a, 'menu_import_failed');
    expect(restaurant.alertPosMenuImport).toHaveBeenCalledTimes(2);
  });

  it('a chat that fails does not fail the caller', async () => {
    restaurant.alertPosMenuImport.mockRejectedValueOnce(new Error('403'));
    await expect(
      service.raise(rows.a, 'menu_import_failed'),
    ).resolves.toBeUndefined();
  });

  it('one rejected key is the venue; two venues within 10 minutes are the platform', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(await service.keyRejected('a')).toBe(false);
    rows.a.status = 'needs_reconnect';
    rows.a.alert = 'key_revoked';
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    expect(await service.keyRejected('b')).toBe(true);
    // The venue marked in the window is not asked to reconnect after all
    expect(rows.a).toMatchObject({ status: 'active', alert: null });
    expect(ops.alert).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('rejections more than 10 minutes apart are two venue problems', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await service.keyRejected('a');
    now.mockReturnValue(1_000_000 + 11 * 60_000);
    expect(await service.keyRejected('b')).toBe(false);
    now.mockRestore();
  });

  it('the platform alarm reaches the ops chat once an hour', async () => {
    await service.platform('application rejected');
    await service.platform('application rejected');
    expect(ops.alert).toHaveBeenCalledTimes(1);
    redis.advance(3601);
    await service.platform('application rejected');
    expect(ops.alert).toHaveBeenCalledTimes(2);
  });
});
