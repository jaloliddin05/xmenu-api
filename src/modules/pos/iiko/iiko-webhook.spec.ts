import { parseIikoWebhook } from './iiko-webhook';

const stopList = {
  eventType: 'StopListUpdate',
  eventTime: '2026-11-17 10:00:00.123',
  organizationId: 'org-1',
  correlationId: 'c-1',
  eventInfo: {
    terminalGroupsStopListsUpdates: [
      { id: 'tg-1', isFull: false },
      { id: 'tg-2', isFull: true },
    ],
  },
};

describe('parseIikoWebhook', () => {
  it('reads an array of events with the terminal groups of a stop list update', () => {
    const [event] = parseIikoWebhook([stopList]);
    expect(event).toMatchObject({
      type: 'StopListUpdate',
      externalOrgId: 'org-1',
      terminalGroupIds: ['tg-1', 'tg-2'],
    });
    expect(event.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the same event delivered again has the same key; another event a different one', () => {
    const [a] = parseIikoWebhook([stopList]);
    const [b] = parseIikoWebhook([{ ...stopList }]);
    const [c] = parseIikoWebhook([{ ...stopList, correlationId: 'c-2' }]);
    expect(a.key).toBe(b.key);
    expect(c.key).not.toBe(a.key);
  });

  it('skips what is not an event', () => {
    expect(parseIikoWebhook([null, 1, 'x', {}, { eventType: 7 }])).toEqual([]);
    expect(parseIikoWebhook(null)).toEqual([]);
  });

  it('takes a single event object too', () => {
    expect(parseIikoWebhook(stopList)).toHaveLength(1);
  });
});
