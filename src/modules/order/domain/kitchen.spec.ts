import {
  isKitchenStep,
  isPosControlled,
  kitchenCheck,
  kitchenModeOf,
} from './kitchen';

const step = (over: Partial<Parameters<typeof kitchenCheck>[0]> = {}) =>
  kitchenCheck({
    from: 'accepted',
    to: 'ready',
    fulfillment: 'delivery',
    trackPreparation: false,
    posControlled: false,
    override: false,
    ...over,
  });

describe('kitchenModeOf', () => {
  it('the setting alone, or iiko connected turns the queue on', () => {
    expect(kitchenModeOf(false, null)).toEqual({
      trackPreparation: false,
      posLive: false,
      posCouriers: false,
    });
    expect(kitchenModeOf(true, null).trackPreparation).toBe(true);
    for (const status of ['active', 'needs_reconnect'])
      expect(kitchenModeOf(false, { status, courier_mode: 'xmenu' })).toEqual({
        trackPreparation: true,
        posLive: true,
        posCouriers: false,
      });
    expect(
      kitchenModeOf(false, { status: 'active', courier_mode: 'iiko' })
        .posCouriers,
    ).toBe(true);
    // Not connected yet or disconnected: the venue's own setting
    for (const status of ['draft', 'disconnected'])
      expect(kitchenModeOf(false, { status, courier_mode: 'iiko' })).toEqual({
        trackPreparation: false,
        posLive: false,
        posCouriers: false,
      });
  });
});

describe('isPosControlled', () => {
  it('only an order that reached iiko while iiko is connected', () => {
    expect(isPosControlled(true, 'sent')).toBe(true);
    for (const state of [
      'queued',
      'sending',
      'failed',
      'needs_street',
      'manual',
      null,
    ])
      expect(isPosControlled(true, state)).toBe(false);
    expect(isPosControlled(false, 'sent')).toBe(false);
  });
});

describe('isKitchenStep', () => {
  it('accepted or preparing to preparing or ready', () => {
    expect(isKitchenStep('accepted', 'preparing')).toBe(true);
    expect(isKitchenStep('accepted', 'ready')).toBe(true);
    expect(isKitchenStep('preparing', 'ready')).toBe(true);
    for (const [from, to] of [
      ['pending_acceptance', 'accepted'],
      ['accepted', 'cancelled'],
      ['ready', 'completed'],
      ['problem_at_door', 'returned_to_restaurant'],
      ['accepted', 'handed_to_external'],
    ] as const)
      expect(isKitchenStep(from, to)).toBe(false);
  });
});

describe('kitchenCheck', () => {
  it('delivery without the kitchen queue: accepted → ready, never into preparing; an order preparing still finishes', () => {
    expect(step()).toEqual({ ok: true, overridden: false });
    expect(step({ to: 'preparing' })).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(step({ from: 'preparing' })).toEqual({
      ok: true,
      overridden: false,
    });
  });

  it('delivery with the kitchen queue: through preparing only', () => {
    const on = { trackPreparation: true };
    expect(step(on)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(step({ ...on, to: 'preparing' })).toEqual({
      ok: true,
      overridden: false,
    });
    expect(step({ ...on, from: 'preparing' })).toMatchObject({ ok: true });
  });

  it('pickup keeps its steps whatever the setting', () => {
    for (const trackPreparation of [true, false]) {
      const pickup = { fulfillment: 'pickup' as const, trackPreparation };
      expect(step({ ...pickup, to: 'preparing' })).toMatchObject({ ok: true });
      expect(step({ ...pickup, from: 'preparing' })).toMatchObject({
        ok: true,
      });
    }
  });

  it('iiko leads the order: every kitchen step refused without the override', () => {
    const iiko = { trackPreparation: true, posControlled: true };
    for (const [from, to] of [
      ['accepted', 'preparing'],
      ['preparing', 'ready'],
      ['accepted', 'ready'],
    ] as const)
      expect(step({ ...iiko, from, to })).toEqual({
        ok: false,
        reason: 'pos_controlled',
      });
    expect(step({ ...iiko, fulfillment: 'pickup', from: 'preparing' })).toEqual(
      { ok: false, reason: 'pos_controlled' },
    );
  });

  it('with the override the step goes through and is marked, accepted → ready of a delivery included', () => {
    const iiko = {
      trackPreparation: true,
      posControlled: true,
      override: true,
    };
    expect(step(iiko)).toEqual({ ok: true, overridden: true });
    expect(step({ ...iiko, from: 'preparing' })).toEqual({
      ok: true,
      overridden: true,
    });
  });

  it('the override means nothing for an order iiko does not lead', () => {
    expect(step({ trackPreparation: true, override: true })).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(step({ override: true })).toEqual({ ok: true, overridden: false });
  });

  it('not a kitchen step: no rules here', () => {
    expect(
      step({ from: 'ready', to: 'completed', posControlled: true }),
    ).toEqual({ ok: true, overridden: false });
  });
});
