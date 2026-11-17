import {
  callFailure,
  creationFailure,
  POS_PUSH_ATTEMPTS,
  POS_RETRY_DELAYS_MS,
  retryDelay,
} from './pos-order-errors';

describe('POS order failures', () => {
  it('5 attempts within 10 minutes, then no more', () => {
    expect(POS_PUSH_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4, 5].map(retryDelay)).toEqual([
      60_000,
      120_000,
      180_000,
      240_000,
      null,
    ]);
    expect(POS_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(600_000);
  });

  it.each([
    ['pos_unavailable', { reason: 'pos_unavailable', retry: true }],
    ['internal_error', { reason: 'pos_unavailable', retry: true }],
    ['pos_key_invalid', { reason: 'pos_key_invalid', retry: false }],
    ['pos_module_missing', { reason: 'pos_module_missing', retry: false }],
    ['pos_access_denied', { reason: 'pos_access_denied', retry: false }],
    ['pos_access_blocked', { reason: 'pos_access_blocked', retry: false }],
  ])('a failed call %s → %j', (code, expected) => {
    expect(callFailure(code)).toEqual(expected);
  });

  it.each([
    ['TimeoutOnFront', { reason: 'pos_not_taken', retry: true }],
    ['TransportToFrontTimeout', { reason: 'pos_not_taken', retry: true }],
    ['StopListedProduct', { reason: 'pos_rejected_stop_list', retry: false }],
    [
      'RequestProductPriceIsNotEqualToFrontPrice',
      { reason: 'pos_rejected_price', retry: false },
    ],
    ['ProductNotFound', { reason: 'pos_rejected_data', retry: false }],
    [null, { reason: 'pos_unavailable', retry: true }],
  ])('iiko refused the order %s → %j', (code, expected) => {
    expect(creationFailure(code)).toEqual(expected);
  });
});
