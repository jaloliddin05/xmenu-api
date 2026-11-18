import { deliveredPushSteps } from './delivered-push';

describe('deliveredPushSteps', () => {
  it.each([
    ['Waiting', ['OnWay', 'Delivered']],
    ['OnWay', ['Delivered']],
    ['Delivered', []],
    ['Closed', []],
  ] as const)('iiko %s: %j', (status, steps) => {
    expect(deliveredPushSteps(status)).toEqual(steps);
  });

  it.each([
    'Unconfirmed',
    'WaitCooking',
    'ReadyForCooking',
    'CookingStarted',
    'CookingCompleted',
    'Cancelled',
    null,
  ] as const)('iiko %s: blocked, nothing is sent', (status) => {
    expect(deliveredPushSteps(status)).toBe('blocked');
  });
});
