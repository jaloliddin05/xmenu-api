import {
  missingForEnable,
  requiredPaymentMethods,
  stepStatus,
} from './pos-steps';

const ready = {
  externalOrgId: 'org',
  addressFormat: 'city',
  branchLinks: 1,
  paymentMethods: ['cash'],
  requiredPaymentMethods: ['cash'],
  deliveryItemId: 'dlv',
  externalMenuId: 'menu',
};

describe('POS connection steps', () => {
  it('all done', () => {
    expect(stepStatus(ready)).toEqual({
      key: 'done',
      organization: 'done',
      branches: 'done',
      payments: 'done',
      menu: 'done',
    });
  });

  it('payments need every required method and the "Delivery" item', () => {
    expect(
      stepStatus({ ...ready, requiredPaymentMethods: ['cash', 'card'] })
        .payments,
    ).toBe('todo');
    expect(stepStatus({ ...ready, deliveryItemId: null }).payments).toBe(
      'todo',
    );
  });

  it('cash is always required (pickup); card and online when the venue offers them', () => {
    expect(
      requiredPaymentMethods({
        delivery_pay_card: false,
        delivery_pay_online: false,
      }),
    ).toEqual(['cash']);
    expect(
      requiredPaymentMethods({
        delivery_pay_card: true,
        delivery_pay_online: true,
      }),
    ).toEqual(['cash', 'card', 'online']);
  });

  it('lists unfinished steps and checks that are not green', () => {
    expect(
      missingForEnable(
        stepStatus({ ...ready, branchLinks: 0, externalMenuId: null }),
        [
          { key: 'key_access', status: 'ok' },
          {
            key: 'delivery_module',
            status: 'fail',
            code: 'pos_module_missing',
          },
          { key: 'terminal_alive', status: 'unknown', branchId: 'b1' },
        ],
      ),
    ).toEqual([
      'step:branches',
      'step:menu',
      'check:delivery_module',
      'check:terminal_alive:b1',
    ]);
  });
});
