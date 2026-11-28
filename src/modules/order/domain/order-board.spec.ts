import {
  acceptDeadlineAt,
  attention,
  byStatusSince,
  itemsSummary,
  shortAddress,
  statusEntry,
  statusSince,
  tashkentDayStart,
  type BoardOrderFacts,
} from './order-board';

const now = new Date('2026-11-24T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const T = {
  pickupReminderMinutes: 5,
  onTheWayAlertMinutes: 60,
  posCouriers: false,
};

const order = (extra: Partial<BoardOrderFacts> = {}): BoardOrderFacts => ({
  status: 'accepted',
  fulfillment: 'delivery',
  created_at: minutesAgo(30),
  courier_id: null,
  ready_at: null,
  picked_up_at: null,
  pos_state: null,
  ...extra,
});

describe('attention', () => {
  it.each<[string, Partial<BoardOrderFacts>, string | null, string[]]>([
    ['accepted without a courier', {}, 'pending_acceptance', ['no_courier']],
    ['accepted with a courier', { courier_id: 'c' }, 'pending_acceptance', []],
    [
      'ready without a courier',
      { status: 'ready', ready_at: minutesAgo(1) },
      'accepted',
      ['no_courier'],
    ],
    [
      'ready with a courier, picked up not pressed in time',
      { status: 'ready', courier_id: 'c', ready_at: minutesAgo(5) },
      'accepted',
      ['not_picked_up'],
    ],
    [
      'ready with a courier, still in time',
      { status: 'ready', courier_id: 'c', ready_at: minutesAgo(4) },
      'accepted',
      [],
    ],
    [
      'on the way too long',
      { status: 'on_the_way', courier_id: 'c', picked_up_at: minutesAgo(60) },
      'ready',
      ['long_on_the_way'],
    ],
    [
      'on the way in time',
      { status: 'on_the_way', courier_id: 'c', picked_up_at: minutesAgo(10) },
      'ready',
      [],
    ],
    [
      'problem at the door',
      { status: 'problem_at_door', courier_id: 'c' },
      'on_the_way',
      ['at_door'],
    ],
    [
      'back to ready after "cannot deliver"',
      { status: 'ready', ready_at: minutesAgo(1) },
      'on_the_way',
      ['no_courier', 'courier_returned'],
    ],
    [
      'back to ready after a disabled courier left the door',
      { status: 'ready', ready_at: minutesAgo(1) },
      'problem_at_door',
      ['no_courier', 'courier_returned'],
    ],
    [
      'iiko did not take it',
      { courier_id: 'c', pos_state: 'failed' },
      'pending_acceptance',
      ['pos_needs_action'],
    ],
    [
      'iiko needs a street, and no courier',
      { pos_state: 'needs_street' },
      'pending_acceptance',
      ['pos_needs_action', 'no_courier'],
    ],
    ['a new order', { status: 'pending_acceptance' }, null, []],
  ])('%s', (_name, extra, enteredFrom, codes) => {
    expect(attention(order(extra), enteredFrom, T, now)).toEqual(codes);
  });

  it('pickup has no courier codes, only iiko', () => {
    expect(
      attention(order({ fulfillment: 'pickup' }), 'pending_acceptance', T, now),
    ).toEqual([]);
    expect(
      attention(
        order({ fulfillment: 'pickup', pos_state: 'failed' }),
        null,
        T,
        now,
      ),
    ).toEqual(['pos_needs_action']);
  });

  it('iiko couriers: Xmenu courier codes are off, the iiko one stays', () => {
    const iiko = { ...T, posCouriers: true };
    expect(attention(order(), 'pending_acceptance', iiko, now)).toEqual([]);
    expect(
      attention(order({ status: 'problem_at_door' }), 'on_the_way', iiko, now),
    ).toEqual([]);
    expect(
      attention(order({ pos_state: 'needs_street' }), null, iiko, now),
    ).toEqual(['pos_needs_action']);
  });
});

describe('statusEntry and statusSince', () => {
  const events = [
    // newest first; the courier assignment (from = to) is not a status change
    {
      from_status: 'accepted',
      to_status: 'accepted',
      created_at: minutesAgo(2),
    },
    {
      from_status: 'pending_acceptance',
      to_status: 'accepted',
      created_at: minutesAgo(10),
    },
    {
      from_status: null,
      to_status: 'pending_acceptance',
      created_at: minutesAgo(12),
    },
  ];

  it('skips journal entries without a status change', () => {
    expect(statusEntry('accepted', events)?.created_at).toEqual(minutesAgo(10));
    expect(
      statusSince({ status: 'accepted', created_at: minutesAgo(12) }, events),
    ).toEqual(minutesAgo(10));
  });

  it('falls back to the creation time without an entry', () => {
    expect(
      statusSince({ status: 'ready', created_at: minutesAgo(40) }, events),
    ).toEqual(minutesAgo(40));
  });

  it('the latest episode counts when the status came back', () => {
    const again = [
      {
        from_status: 'on_the_way',
        to_status: 'ready',
        created_at: minutesAgo(1),
      },
      {
        from_status: 'ready',
        to_status: 'on_the_way',
        created_at: minutesAgo(20),
      },
      {
        from_status: 'accepted',
        to_status: 'ready',
        created_at: minutesAgo(25),
      },
    ];
    expect(statusEntry('ready', again)).toMatchObject({
      from_status: 'on_the_way',
      created_at: minutesAgo(1),
    });
  });
});

describe('acceptDeadlineAt', () => {
  it('a cash order: entering pending_acceptance plus the timeout', () => {
    expect(
      acceptDeadlineAt('pending_acceptance', minutesAgo(1), 300)?.toISOString(),
    ).toBe(new Date(now.getTime() + 4 * 60_000).toISOString());
  });

  it('an online order: counted from the payment, not from the creation', () => {
    const created = minutesAgo(9);
    const paid = [
      {
        from_status: 'awaiting_payment',
        to_status: 'pending_acceptance',
        created_at: minutesAgo(1),
      },
      {
        from_status: null,
        to_status: 'awaiting_payment',
        created_at: created,
      },
    ];
    const since = statusSince(
      { status: 'pending_acceptance', created_at: created },
      paid,
    );
    expect(acceptDeadlineAt('pending_acceptance', since, 300)).toEqual(
      new Date(minutesAgo(1).getTime() + 300_000),
    );
  });

  it('null in any other status', () => {
    expect(acceptDeadlineAt('accepted', minutesAgo(1), 300)).toBeNull();
  });
});

describe('shortAddress', () => {
  it('only the street line', () => {
    expect(
      shortAddress({
        address: ' Amir Temur 15 ',
        entrance: '2',
        floor: '5',
        apartment: '51',
        comment: 'call me +998901112233',
      }),
    ).toBe('Amir Temur 15');
  });

  it.each([null, undefined, 'x', {}, { address: '  ' }])(
    'null for %j',
    (snapshot) => expect(shortAddress(snapshot)).toBeNull(),
  );
});

describe('itemsSummary', () => {
  it('counts quantities and previews the first four by position', () => {
    const items = [5, 1, 4, 2, 3].map((position) => ({
      name: `dish ${position}`,
      quantity: position,
      position,
    }));
    expect(itemsSummary(items)).toEqual({
      itemsCount: 15,
      itemsPreview: [1, 2, 3, 4].map((p) => ({
        name: `dish ${p}`,
        quantity: p,
      })),
    });
  });
});

describe('byStatusSince', () => {
  it('the longest in its status first, the number settles a tie', () => {
    const list = [
      { statusSince: minutesAgo(1).toISOString(), number: 3 },
      { statusSince: minutesAgo(5).toISOString(), number: 2 },
      { statusSince: minutesAgo(5).toISOString(), number: 1 },
    ];
    expect(list.sort(byStatusSince).map((o) => o.number)).toEqual([1, 2, 3]);
  });
});

describe('tashkentDayStart', () => {
  it.each([
    ['2026-11-24T12:00:00Z', '2026-11-23T19:00:00.000Z'],
    // 23:30 UTC is already the next day in Tashkent
    ['2026-11-24T23:30:00Z', '2026-11-24T19:00:00.000Z'],
    ['2026-11-24T18:59:59Z', '2026-11-23T19:00:00.000Z'],
  ])('%s → %s', (at, start) => {
    expect(tashkentDayStart(new Date(at)).toISOString()).toBe(start);
  });
});
