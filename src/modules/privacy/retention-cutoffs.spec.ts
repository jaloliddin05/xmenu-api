import { retentionCutoffs } from './retention-cutoffs';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-22T00:00:00.000Z');

describe('retentionCutoffs', () => {
  it('uses 365 days for orders and applications by default, 90 days for audit events, 7 for sessions', () => {
    const c = retentionCutoffs(now, {});
    expect(c.orders.getTime()).toBe(now.getTime() - 365 * DAY);
    expect(c.applications.getTime()).toBe(now.getTime() - 365 * DAY);
    expect(c.staffAuthEvents.getTime()).toBe(now.getTime() - 90 * DAY);
    expect(c.staffSessions.getTime()).toBe(now.getTime() - 7 * DAY);
    expect(c.pushSubscriptions.getTime()).toBe(now.getTime() - 30 * DAY);
  });

  it('reads the periods from the environment', () => {
    const c = retentionCutoffs(now, {
      ORDER_PII_RETENTION_DAYS: '30',
      APPLICATION_RETENTION_DAYS: '10',
    });
    expect(c.orders.getTime()).toBe(now.getTime() - 30 * DAY);
    expect(c.applications.getTime()).toBe(now.getTime() - 10 * DAY);
  });

  it.each(['', 'abc', '0', '-5'])('falls back to 365 days for %p', (value) => {
    const c = retentionCutoffs(now, { ORDER_PII_RETENTION_DAYS: value });
    expect(c.orders.getTime()).toBe(now.getTime() - 365 * DAY);
  });

  it('a row exactly N days old is not older than the cutoff (kept), one millisecond older is', () => {
    const c = retentionCutoffs(now, { ORDER_PII_RETENTION_DAYS: '30' });
    const exactly = new Date(now.getTime() - 30 * DAY);
    const older = new Date(now.getTime() - 30 * DAY - 1);
    expect(exactly < c.orders).toBe(false);
    expect(older < c.orders).toBe(true);
  });
});
