import { deliveryModeProblem, initDataChecked } from './delivery-mode';

describe('deliveryModeProblem', () => {
  it.each([
    ['site', 'absent', null],
    ['site', 'invalid', null],
    ['site', 'valid', null],
    ['miniapp', 'absent', 'miniapp_required'],
    ['miniapp', 'invalid', 'miniapp_init_data_invalid'],
    ['miniapp', 'valid', null],
    ['both', 'absent', null],
    ['both', 'invalid', 'miniapp_init_data_invalid'],
    ['both', 'valid', null],
  ] as const)('%s with %s initData → %s', (mode, initData, problem) => {
    expect(deliveryModeProblem(mode, initData)).toBe(problem);
  });
});

describe('initDataChecked', () => {
  it('site never looks at the header, miniapp always, both only when it came', () => {
    expect(initDataChecked('site', 'x')).toBe(false);
    expect(initDataChecked('miniapp', undefined)).toBe(true);
    expect(initDataChecked('both', undefined)).toBe(false);
    expect(initDataChecked('both', 'x')).toBe(true);
  });
});
