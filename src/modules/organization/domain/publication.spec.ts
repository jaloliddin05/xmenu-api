import {
  guestLoginWarnings,
  BranchFacts,
  CHECKLIST_IDS,
  ChecklistId,
  evaluateChecklist,
  isReady,
  modeNeedsBot,
  orderingOpen,
  orderingProblem,
  PublicationFacts,
} from './publication';

const BRANCH: BranchFacts = {
  hasHours: true,
  hasCoordinates: true,
  acceptsPickup: true,
  acceptsDelivery: true,
  hasDeliveryPricing: true,
};

const READY: PublicationFacts = {
  name: 'Demo Cafe',
  slug: 'demo-cafe',
  deliveryEnabled: true,
  deliveryMode: 'site',
  hasActiveCategory: true,
  hasActiveProduct: true,
  branches: [BRANCH],
  botConnected: false,
};

const item = (facts: Partial<PublicationFacts>, id: ChecklistId) =>
  evaluateChecklist({ ...READY, ...facts }).find((i) => i.id === id)!;

describe('evaluateChecklist', () => {
  it('lists every item once, in a fixed order', () => {
    expect(evaluateChecklist(READY).map((i) => i.id)).toEqual([
      ...CHECKLIST_IDS,
    ]);
  });

  it('a ready venue has nothing to do; hints only on todo items', () => {
    const items = evaluateChecklist(READY);
    expect(isReady(items)).toBe(true);
    expect(items.every((i) => i.hint === null)).toBe(true);
  });

  it.each<[ChecklistId, Partial<PublicationFacts>]>([
    ['delivery_channel', { deliveryEnabled: false }],
    ['venue_name', { name: '   ' }],
    ['venue_name', { name: '' }], // rows saved before the name became required
    ['venue_slug', { slug: null }],
    ['venue_slug', { slug: 'Bad Slug' }],
    ['venue_slug', { slug: 'api' }],
    ['menu_category', { hasActiveCategory: false }],
    ['menu_product', { hasActiveProduct: false }],
    ['branch', { branches: [] }],
    [
      'delivery_pricing',
      { branches: [{ ...BRANCH, hasDeliveryPricing: false }] },
    ],
    ['telegram_bot', { deliveryMode: 'miniapp', botConnected: false }],
    ['telegram_bot', { deliveryMode: 'both', botConnected: false }],
  ])('%s is todo for %p, with a hint, and blocks', (id, facts) => {
    const r = item(facts, id);
    expect(r.status).toBe('todo');
    expect(r.hint).toEqual(expect.any(String));
    expect(isReady(evaluateChecklist({ ...READY, ...facts }))).toBe(false);
  });

  it.each<[ChecklistId, Partial<PublicationFacts>]>([
    ['venue_name', { name: 'Кафе' }],
    ['venue_slug', { slug: 'kafe-1' }],
    ['telegram_bot', { deliveryMode: 'miniapp', botConnected: true }],
    ['telegram_bot', { deliveryMode: 'both', botConnected: true }],
  ])('%s is done for %p', (id, facts) => {
    expect(item(facts, id).status).toBe('done');
  });

  it('telegram bot is not required for the website mode', () => {
    expect(
      item({ deliveryMode: 'site', botConnected: false }, 'telegram_bot'),
    ).toEqual({ id: 'telegram_bot', status: 'not_required', hint: null });
  });

  it('delivery pricing is not required when no branch delivers', () => {
    const facts = {
      branches: [
        { ...BRANCH, acceptsDelivery: false, hasDeliveryPricing: false },
      ],
    };
    expect(item(facts, 'delivery_pricing').status).toBe('not_required');
    expect(isReady(evaluateChecklist({ ...READY, ...facts }))).toBe(true);
  });

  it('delivery pricing is required as soon as one branch delivers', () => {
    const facts = {
      branches: [
        { ...BRANCH, acceptsDelivery: false, hasDeliveryPricing: false },
        { ...BRANCH, hasDeliveryPricing: false },
      ],
    };
    expect(item(facts, 'delivery_pricing').status).toBe('todo');
  });

  it('pricing on a branch that does not deliver does not count', () => {
    const facts = {
      branches: [
        { ...BRANCH, acceptsDelivery: false, hasDeliveryPricing: true },
        { ...BRANCH, hasDeliveryPricing: false },
      ],
    };
    expect(item(facts, 'delivery_pricing').status).toBe('todo');
    expect(
      item({ branches: [...facts.branches, { ...BRANCH }] }, 'delivery_pricing')
        .status,
    ).toBe('done');
  });

  describe('branch', () => {
    const status = (branches: BranchFacts[]) => item({ branches }, 'branch');

    it('no branch: todo, asks to add one', () => {
      expect(status([]).hint).toMatch(/Добавьте филиал/);
    });

    it('no working hours: todo, names the hours', () => {
      const r = status([{ ...BRANCH, hasHours: false }]);
      expect(r.status).toBe('todo');
      expect(r.hint).toMatch(/часы работы/);
      expect(r.hint).not.toMatch(/карте/);
    });

    it('no coordinates: todo, names the map point', () => {
      const r = status([{ ...BRANCH, hasCoordinates: false }]);
      expect(r.status).toBe('todo');
      expect(r.hint).toMatch(/точку на карте/);
    });

    it('accepts neither pickup nor delivery: todo', () => {
      const r = status([
        { ...BRANCH, acceptsPickup: false, acceptsDelivery: false },
      ]);
      expect(r.status).toBe('todo');
      expect(r.hint).toMatch(/самовывоз или доставку/);
    });

    it('pickup only is enough', () => {
      expect(status([{ ...BRANCH, acceptsDelivery: false }]).status).toBe(
        'done',
      );
    });

    it('hours and coordinates on different branches do not count', () => {
      const r = status([
        { ...BRANCH, hasHours: false },
        { ...BRANCH, hasCoordinates: false },
      ]);
      expect(r.status).toBe('todo');
      expect(r.hint).toMatch(/один филиал/);
    });

    it('one ready branch among unready ones is enough', () => {
      expect(status([{ ...BRANCH, hasHours: false }, BRANCH]).status).toBe(
        'done',
      );
    });
  });

  it('several problems at once: each is its own todo item', () => {
    const items = evaluateChecklist({
      ...READY,
      deliveryEnabled: false,
      hasActiveCategory: false,
      hasActiveProduct: false,
      branches: [],
    });
    expect(items.filter((i) => i.status === 'todo').map((i) => i.id)).toEqual([
      'delivery_channel',
      'menu_category',
      'menu_product',
      'branch',
    ]);
  });
});

describe('modeNeedsBot', () => {
  it('only the website works without a bot', () => {
    expect(modeNeedsBot('site')).toBe(false);
    expect(modeNeedsBot('miniapp')).toBe(true);
    expect(modeNeedsBot('both')).toBe(true);
  });
});

describe('orderingProblem', () => {
  const at = new Date('2026-10-31T10:00:00Z');

  it('channel off comes first, even with a stale publication', () => {
    expect(orderingProblem({ deliveryEnabled: false, publishedAt: null })).toBe(
      'ordering_channel_disabled',
    );
    expect(orderingProblem({ deliveryEnabled: false, publishedAt: at })).toBe(
      'ordering_channel_disabled',
    );
  });

  it('channel on but not published (or paused)', () => {
    expect(orderingProblem({ deliveryEnabled: true, publishedAt: null })).toBe(
      'ordering_not_published',
    );
  });

  it('channel on and published: open', () => {
    expect(orderingProblem({ deliveryEnabled: true, publishedAt: at })).toBe(
      null,
    );
    expect(orderingOpen({ deliveryEnabled: true, publishedAt: at })).toBe(true);
    expect(orderingOpen({ deliveryEnabled: true, publishedAt: null })).toBe(
      false,
    );
  });
});

describe('guestLoginWarnings', () => {
  const ids = (
    deliveryEnabled: boolean,
    deliveryMode: 'site' | 'miniapp' | 'both',
    sms: boolean,
    telegram: boolean,
  ) =>
    guestLoginWarnings(
      { deliveryEnabled, deliveryMode },
      { sms, telegram },
    ).map((w) => w.id);

  // Every combination: [ordering on, mode, sms, telegram] -> warnings
  it.each<[boolean, 'site' | 'miniapp' | 'both', boolean, boolean, string[]]>([
    [true, 'site', true, true, []],
    [true, 'site', true, false, []],
    [true, 'site', false, true, ['guest_login_telegram_only']],
    [true, 'site', false, false, ['guest_login_unavailable']],
    [true, 'both', true, true, []],
    [true, 'both', true, false, []],
    [true, 'both', false, true, ['guest_login_telegram_only']],
    [true, 'both', false, false, ['guest_login_unavailable']],
    // Mini App customers are in Telegram: the bot alone is enough
    [true, 'miniapp', true, true, []],
    [true, 'miniapp', true, false, []],
    [true, 'miniapp', false, true, []],
    [true, 'miniapp', false, false, ['guest_login_unavailable']],
    // Ordering off: nobody needs to sign in
    [false, 'site', false, false, []],
    [false, 'site', false, true, []],
    [false, 'both', false, true, []],
    [false, 'miniapp', false, false, []],
  ])(
    'ordering %s, mode %s, sms %s, telegram %s -> %j',
    (enabled, mode, sms, telegram, expected) => {
      expect(ids(enabled, mode, sms, telegram)).toEqual(expected);
    },
  );

  it('every warning has a hint for the owner', () => {
    for (const w of [
      ...guestLoginWarnings(
        { deliveryEnabled: true, deliveryMode: 'site' },
        { sms: false, telegram: true },
      ),
      ...guestLoginWarnings(
        { deliveryEnabled: true, deliveryMode: 'site' },
        { sms: false, telegram: false },
      ),
    ])
      expect(w.hint.length).toBeGreaterThan(10);
  });
});
