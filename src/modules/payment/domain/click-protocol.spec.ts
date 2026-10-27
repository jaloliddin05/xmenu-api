import {
  CLICK_ERROR,
  ClickOrder,
  ClickPayment,
  ClickProtocol,
  ClickRequest,
  ClickStore,
  clickSign,
  verifyClickSign,
} from './click-protocol';

const SECRET = 'click-secret';
const SERVICE = '777';

class MemoryStore implements ClickStore {
  orders = new Map<string, ClickOrder>();
  payments: ClickPayment[] = [];
  seq = 100;
  paidOrders: string[] = [];
  failNextMarkPaid = false;
  async findOrder(id: string) { return this.orders.get(id) ?? null; }
  async findPaymentBySeq(seq: number) { return this.payments.find((p) => p.seq === seq) ?? null; }
  async findPaymentByClickId(id: string) { return this.payments.find((p) => p.clickTransId === id) ?? null; }
  async createPayment(orderId: string, clickTransId: string, amount: number) {
    const p: ClickPayment = { seq: ++this.seq, orderId, clickTransId, amount, status: 'created' };
    this.payments.push(p);
    return p;
  }
  async markPaid(p: ClickPayment) {
    if (this.failNextMarkPaid) { p.status = 'cancelled'; return false; }
    p.status = 'paid';
    this.paidOrders.push(p.orderId);
    const o = this.orders.get(p.orderId)!;
    o.paid = true;
    o.payable = false;
    return true;
  }
  async markCancelled(p: ClickPayment) { p.status = 'cancelled'; }
}

function req(over: Partial<ClickRequest> & { action: '0' | '1' }): ClickRequest {
  const r: ClickRequest = {
    click_trans_id: '555',
    service_id: SERVICE,
    click_paydoc_id: '999',
    merchant_trans_id: 'order-1',
    amount: '113000',
    error: '0',
    sign_time: '2026-10-10 10:00:00',
    ...over,
  };
  r.sign_string = over.sign_string ?? clickSign(r, SECRET);
  return r;
}

function setup() {
  const store = new MemoryStore();
  store.orders.set('order-1', { id: 'order-1', total: 113000, payable: true, paid: false });
  return { store, click: new ClickProtocol(store, { serviceId: SERVICE, secretKey: SECRET }) };
}

describe('click signature', () => {
  it('prepare and complete signatures differ by merchant_prepare_id', () => {
    const p = req({ action: '0' });
    const c = req({ action: '1', merchant_prepare_id: '101' });
    expect(verifyClickSign(p, SECRET)).toBe(true);
    expect(verifyClickSign(c, SECRET)).toBe(true);
    expect(verifyClickSign({ ...c, merchant_prepare_id: '102' }, SECRET)).toBe(false);
  });

  it('rejects wrong secret, missing sign and tampered amount', () => {
    const p = req({ action: '0' });
    expect(verifyClickSign(p, 'other')).toBe(false);
    expect(verifyClickSign({ ...p, sign_string: undefined }, SECRET)).toBe(false);
    expect(verifyClickSign({ ...p, amount: '1' }, SECRET)).toBe(false);
  });
});

describe('ClickProtocol', () => {
  it('prepare → complete marks the order paid exactly once', async () => {
    const { store, click } = setup();
    const prep = await click.handle('prepare', req({ action: '0' }));
    expect(prep.error).toBe(0);
    expect(prep.merchant_prepare_id).toBe(101);

    const done = await click.handle('complete', req({ action: '1', merchant_prepare_id: '101' }));
    expect(done.error).toBe(0);
    expect(store.paidOrders).toEqual(['order-1']);

    const again = await click.handle('complete', req({ action: '1', merchant_prepare_id: '101' }));
    expect(again.error).toBe(CLICK_ERROR.ALREADY_PAID);
    expect(store.paidOrders).toEqual(['order-1']); // not paid twice
  });

  it('a repeated prepare returns the same prepare id (no second transaction)', async () => {
    const { store, click } = setup();
    const a = await click.handle('prepare', req({ action: '0' }));
    const b = await click.handle('prepare', req({ action: '0' }));
    expect(b.merchant_prepare_id).toBe(a.merchant_prepare_id);
    expect(store.payments).toHaveLength(1);
  });

  it('bad signature is rejected before anything is read', async () => {
    const { click } = setup();
    const r = await click.handle('prepare', req({ action: '0', sign_string: 'deadbeef' }));
    expect(r.error).toBe(CLICK_ERROR.SIGN_FAILED);
  });

  it('wrong amount, unknown order, wrong service, wrong action', async () => {
    const { click } = setup();
    expect((await click.handle('prepare', req({ action: '0', amount: '1000' }))).error).toBe(CLICK_ERROR.INCORRECT_AMOUNT);
    expect((await click.handle('prepare', req({ action: '0', merchant_trans_id: 'nope' }))).error).toBe(CLICK_ERROR.ORDER_NOT_FOUND);
    expect((await click.handle('prepare', req({ action: '0', service_id: '1' }))).error).toBe(CLICK_ERROR.BAD_REQUEST);
    expect((await click.handle('prepare', req({ action: '1' }))).error).toBe(CLICK_ERROR.ACTION_NOT_FOUND);
  });

  it('an order that is no longer payable (cancelled) cannot be prepared', async () => {
    const { store, click } = setup();
    store.orders.get('order-1')!.payable = false;
    expect((await click.handle('prepare', req({ action: '0' }))).error).toBe(CLICK_ERROR.TRANSACTION_CANCELLED);
  });

  it('an already paid order says so', async () => {
    const { store, click } = setup();
    store.orders.get('order-1')!.paid = true;
    store.orders.get('order-1')!.payable = false;
    expect((await click.handle('prepare', req({ action: '0' }))).error).toBe(CLICK_ERROR.ALREADY_PAID);
  });

  it('order cancelled between prepare and complete: money is NOT taken', async () => {
    const { store, click } = setup();
    await click.handle('prepare', req({ action: '0' }));
    store.orders.get('order-1')!.payable = false; // customer cancelled
    const done = await click.handle('complete', req({ action: '1', merchant_prepare_id: '101' }));
    expect(done.error).toBe(CLICK_ERROR.TRANSACTION_CANCELLED);
    expect(store.paidOrders).toEqual([]);
    expect(store.payments[0].status).toBe('cancelled');
  });

  it('order cancelled in the instant between the check and the write: money is not taken', async () => {
    const { store, click } = setup();
    await click.handle('prepare', req({ action: '0' }));
    store.failNextMarkPaid = true; // the store found the order no longer payable under its lock
    const done = await click.handle('complete', req({ action: '1', merchant_prepare_id: '101' }));
    expect(done.error).toBe(CLICK_ERROR.TRANSACTION_CANCELLED);
    expect(store.paidOrders).toEqual([]);
  });

  it('complete with unknown prepare id / mismatching click_trans_id', async () => {
    const { click } = setup();
    await click.handle('prepare', req({ action: '0' }));
    expect((await click.handle('complete', req({ action: '1', merchant_prepare_id: '999' }))).error).toBe(CLICK_ERROR.TRANSACTION_NOT_FOUND);
    expect((await click.handle('complete', req({ action: '1', merchant_prepare_id: '101', click_trans_id: '556' }))).error).toBe(CLICK_ERROR.TRANSACTION_NOT_FOUND);
  });

  it('Click reporting its own payment error cancels the transaction', async () => {
    const { store, click } = setup();
    await click.handle('prepare', req({ action: '0' }));
    const r = await click.handle('complete', req({ action: '1', merchant_prepare_id: '101', error: '-5017' }));
    expect(r.error).toBe(CLICK_ERROR.TRANSACTION_CANCELLED);
    expect(store.paidOrders).toEqual([]);
  });
});
