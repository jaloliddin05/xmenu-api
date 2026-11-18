import { menuImportEveryMs, PosSyncQueue } from './pos-sync.queue';

describe('menuImportEveryMs', () => {
  it.each([
    [undefined, 30],
    ['', 30],
    ['abc', 30],
    ['15', 15],
    ['1', 5],
    ['100000', 1440],
  ])('IIKO_MENU_IMPORT_MINUTES=%s: every %s minutes', (value, minutes) => {
    expect(
      menuImportEveryMs(
        value === undefined ? {} : { IIKO_MENU_IMPORT_MINUTES: value },
      ),
    ).toBe(minutes * 60_000);
  });
});

describe('PosSyncQueue schedulers', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => (env = { ...process.env }));
  afterEach(() => (process.env = env));

  const setup = () => {
    const upsertJobScheduler = jest.fn(async () => undefined);
    const prisma = {
      pos_integration: {
        findMany: jest.fn(async () => [{ id: 'int-1' }, { id: 'int-2' }]),
      },
    };
    const orders = { schedulePoll: jest.fn(async () => undefined) };
    const sync = new PosSyncQueue(
      prisma as any,
      {} as any,
      {} as any,
      orders as any,
    );
    (sync as any).queue = { upsertJobScheduler };
    return { sync, prisma, upsertJobScheduler };
  };

  it('enabling schedules the import with the configured interval', async () => {
    process.env.IIKO_MENU_IMPORT_MINUTES = '10';
    const { sync, upsertJobScheduler } = setup();
    await sync.schedule('int-1');
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'pos-menu-int-1',
      { every: 10 * 60_000 },
      { name: 'menu', data: { integrationId: 'int-1' } },
    );
  });

  it('on start every working integration gets the current interval', async () => {
    process.env.IIKO_MENU_IMPORT_MINUTES = '45';
    const { sync, prisma, upsertJobScheduler } = setup();
    await sync.rescheduleAll();
    expect(prisma.pos_integration.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['active', 'needs_reconnect'] } },
      select: { id: true },
    });
    expect(
      upsertJobScheduler.mock.calls.map((c: any[]) => [c[0], c[1]]),
    ).toEqual([
      ['pos-menu-int-1', { every: 45 * 60_000 }],
      ['pos-menu-int-2', { every: 45 * 60_000 }],
    ]);
  });
});
