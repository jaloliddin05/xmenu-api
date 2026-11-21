import {
  PRIVACY_RETENTION_PATTERN,
  PRIVACY_RETENTION_SCHEDULER_ID,
  PRIVACY_RETENTION_TZ,
  PrivacyRetentionQueue,
} from './privacy-retention.queue';

describe('PrivacyRetentionQueue', () => {
  it('schedules one daily job at 03:00 Asia/Tashkent', async () => {
    const upsertJobScheduler = jest.fn(async () => undefined);
    const queue = new PrivacyRetentionQueue({} as never);
    (queue as unknown as { queue: unknown }).queue = { upsertJobScheduler };

    await queue.schedule();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      PRIVACY_RETENTION_SCHEDULER_ID,
      { pattern: '0 3 * * *', tz: 'Asia/Tashkent' },
      expect.objectContaining({ name: 'run' }),
    );
    expect(PRIVACY_RETENTION_PATTERN).toBe('0 3 * * *');
    expect(PRIVACY_RETENTION_TZ).toBe('Asia/Tashkent');
  });

  it('starts nothing with ORDER_QUEUES=off', () => {
    const before = process.env.ORDER_QUEUES;
    process.env.ORDER_QUEUES = 'off';
    try {
      const queue = new PrivacyRetentionQueue({} as never);
      expect(queue.enabled).toBe(false);
      queue.onModuleInit();
      expect((queue as unknown as { worker?: unknown }).worker).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.ORDER_QUEUES;
      else process.env.ORDER_QUEUES = before;
    }
  });
});
