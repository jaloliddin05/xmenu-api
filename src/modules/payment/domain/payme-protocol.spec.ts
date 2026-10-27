import {
  PAYME_ERROR,
  PAYME_TIMEOUT_MS,
  PaymeOrder,
  PaymeProtocol,
  PaymeStore,
  PaymeTx,
  verifyPaymeAuth,
} from './payme-protocol';

class MemoryStore implements PaymeStore {
  orders = new Map<string, PaymeOrder & { refundable: boolean }>();
  txs: PaymeTx[] = [];
  n = 0;
  paid: string[] = [];
  async findOrder(id: string) { return this.orders.get(id) ?? null; }
  async findTx(id: string) { return this.txs.find((t) => t.id === id) ?? null; }
  async findOpenTxByOrder(orderId: string) { return this.txs.find((t) => t.orderId === orderId && (t.state === 1 || t.state === 2)) ?? null; }
  async createTx(orderId: string, id: string, amountTiyin: number, createTime: number) {
    const tx: PaymeTx = { id, orderId, ourId: `t${++this.n}`, state: 1, amountTiyin, createTime, performTime: 0, cancelTime: 0, reason: null };
    this.txs.push(tx);
    return tx;
  }
  async performTx(tx: PaymeTx, now: number) {
    tx.state = 2; tx.performTime = now;
    this.paid.push(tx.orderId);
    const o = this.orders.get(tx.orderId)!; o.payable = false;
    return tx;
  }
  async cancelTx(tx: PaymeTx, reason: number, now: number) {
    tx.state = tx.state === 2 ? -2 : -1; tx.cancelTime = now; tx.reason = reason;
    return tx;
  }
  async canRefund(tx: PaymeTx) { return this.orders.get(tx.orderId)!.refundable; }
  async statement(from: number, to: number) { return this.txs.filter((t) => t.createTime >= from && t.createTime <= to); }
}

const NOW = 1_800_000_000_000;
let now = NOW;

function setup() {
  now = NOW;
  const store = new MemoryStore();
  store.orders.set('o1', { id: 'o1', totalTiyin: 11_300_000, payable: true, refundable: true });
  return { store, payme: new PaymeProtocol(store, () => now) };
}

const call = (payme: PaymeProtocol, method: string, params: Record<string, any>) => payme.handle({ id: 1, method, params });
const acct = { order_id: 'o1' };
const create = (payme: PaymeProtocol, id = 'p1', amount = 11_300_000) => call(payme, 'CreateTransaction', { id, time: now, amount, account: acct });

describe('verifyPaymeAuth', () => {
  const header = 'Basic ' + Buffer.from('Paycom:KEY').toString('base64');
  it('accepts the right key, rejects everything else', () => {
    expect(verifyPaymeAuth(header, 'KEY')).toBe(true);
    expect(verifyPaymeAuth(header, 'OTHER')).toBe(false);
    expect(verifyPaymeAuth(undefined, 'KEY')).toBe(false);
    expect(verifyPaymeAuth('Bearer x', 'KEY')).toBe(false);
    expect(verifyPaymeAuth('Basic ' + Buffer.from('Other:KEY').toString('base64'), 'KEY')).toBe(false);
  });
});

describe('PaymeProtocol', () => {
  it('rejects malformed requests and unknown methods', async () => {
    const { payme } = setup();
    expect(((await payme.handle({ id: 1 } as any)).error as any).code).toBe(PAYME_ERROR.INVALID_REQUEST);
    expect(((await call(payme, 'Nope', {})).error as any).code).toBe(PAYME_ERROR.METHOD_NOT_FOUND);
  });

  it('CheckPerformTransaction: ok / order missing / wrong amount / not payable', async () => {
    const { store, payme } = setup();
    expect((await call(payme, 'CheckPerformTransaction', { amount: 11_300_000, account: acct })).result).toEqual({ allow: true });
    expect(((await call(payme, 'CheckPerformTransaction', { amount: 11_300_000, account: { order_id: 'zz' } })).error as any).code).toBe(PAYME_ERROR.ORDER_NOT_FOUND);
    expect(((await call(payme, 'CheckPerformTransaction', { amount: 100, account: acct })).error as any).code).toBe(PAYME_ERROR.WRONG_AMOUNT);
    store.orders.get('o1')!.payable = false;
    expect(((await call(payme, 'CheckPerformTransaction', { amount: 11_300_000, account: acct })).error as any).code).toBe(PAYME_ERROR.ORDER_UNAVAILABLE);
  });

  it('create → perform → check; the order is paid exactly once', async () => {
    const { store, payme } = setup();
    const c: any = await create(payme);
    expect(c.result.state).toBe(1);

    const p: any = await call(payme, 'PerformTransaction', { id: 'p1' });
    expect(p.result.state).toBe(2);
    expect(store.paid).toEqual(['o1']);

    const again: any = await call(payme, 'PerformTransaction', { id: 'p1' });
    expect(again.result.state).toBe(2);
    expect(again.result.perform_time).toBe(p.result.perform_time);
    expect(store.paid).toEqual(['o1']);

    const chk: any = await call(payme, 'CheckTransaction', { id: 'p1' });
    expect(chk.result).toMatchObject({ state: 2, reason: null, cancel_time: 0 });
  });

  it('repeated CreateTransaction with the same id returns the same transaction', async () => {
    const { store, payme } = setup();
    const a: any = await create(payme);
    const b: any = await create(payme);
    expect(b.result.transaction).toBe(a.result.transaction);
    expect(store.txs).toHaveLength(1);
  });

  it('a second transaction for the same order is refused', async () => {
    const { payme } = setup();
    await create(payme, 'p1');
    expect(((await create(payme, 'p2')) as any).error.code).toBe(PAYME_ERROR.ORDER_HAS_TRANSACTION);
  });

  it('an expired (12h) unperformed transaction is cancelled with reason 4 and cannot be performed', async () => {
    const { store, payme } = setup();
    await create(payme);
    now += PAYME_TIMEOUT_MS + 1;
    expect(((await call(payme, 'PerformTransaction', { id: 'p1' })) as any).error.code).toBe(PAYME_ERROR.CANT_PERFORM);
    expect(store.txs[0]).toMatchObject({ state: -1, reason: 4 });
    expect(store.paid).toEqual([]);
  });

  it('after the first transaction expired, a new one can be created for the order', async () => {
    const { payme } = setup();
    await create(payme, 'p1');
    now += PAYME_TIMEOUT_MS + 1;
    expect(((await create(payme, 'p2')) as any).result.state).toBe(1);
  });

  it('money is not taken if the order was cancelled between Create and Perform', async () => {
    const { store, payme } = setup();
    await create(payme);
    store.orders.get('o1')!.payable = false; // customer cancelled
    expect(((await call(payme, 'PerformTransaction', { id: 'p1' })) as any).error.code).toBe(PAYME_ERROR.CANT_PERFORM);
    expect(store.paid).toEqual([]);
  });

  it('CancelTransaction: before perform → -1; after perform → -2 only if refundable', async () => {
    const a = setup();
    await create(a.payme);
    expect(((await call(a.payme, 'CancelTransaction', { id: 'p1', reason: 3 })) as any).result.state).toBe(-1);

    const b = setup();
    await create(b.payme);
    await call(b.payme, 'PerformTransaction', { id: 'p1' });
    expect(((await call(b.payme, 'CancelTransaction', { id: 'p1', reason: 5 })) as any).result.state).toBe(-2);

    const c = setup();
    await create(c.payme);
    await call(c.payme, 'PerformTransaction', { id: 'p1' });
    c.store.orders.get('o1')!.refundable = false; // food already handed over
    expect(((await call(c.payme, 'CancelTransaction', { id: 'p1', reason: 5 })) as any).error.code).toBe(PAYME_ERROR.CANT_CANCEL);
  });

  it('cancelling twice is idempotent; performing a cancelled tx is refused', async () => {
    const { payme } = setup();
    await create(payme);
    const first: any = await call(payme, 'CancelTransaction', { id: 'p1', reason: 3 });
    const second: any = await call(payme, 'CancelTransaction', { id: 'p1', reason: 3 });
    expect(second.result.cancel_time).toBe(first.result.cancel_time);
    expect(((await call(payme, 'PerformTransaction', { id: 'p1' })) as any).error.code).toBe(PAYME_ERROR.CANT_PERFORM);
  });

  it('unknown transaction id', async () => {
    const { payme } = setup();
    for (const m of ['PerformTransaction', 'CancelTransaction', 'CheckTransaction']) {
      expect(((await call(payme, m, { id: 'nope' })) as any).error.code).toBe(PAYME_ERROR.TRANSACTION_NOT_FOUND);
    }
  });

  it('GetStatement lists transactions in the time window', async () => {
    const { payme } = setup();
    await create(payme);
    const s: any = await call(payme, 'GetStatement', { from: NOW - 1000, to: NOW + 1000 });
    expect(s.result.transactions).toHaveLength(1);
    expect(s.result.transactions[0]).toMatchObject({ id: 'p1', amount: 11_300_000, account: { order_id: 'o1' }, state: 1 });
    expect(((await call(payme, 'GetStatement', { from: NOW + 5000, to: NOW + 6000 })) as any).result.transactions).toHaveLength(0);
  });
});
