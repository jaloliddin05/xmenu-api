import type { Job } from 'bullmq';
import { EscalationProcessor } from './escalation.processor';
import { ESCALATION_STEPS } from './order-queue.service';

const ORDER_ID = 'order-1';

function setup(status: string) {
  const prisma = {
    customer_order: {
      findUnique: jest.fn(async () => ({
        id: ORDER_ID,
        number: 1001,
        status,
        payment_expires_at: null,
        placed_at: new Date(),
      })),
    },
  };
  const transitions = { transition: jest.fn(async () => undefined) };
  const restaurant = {
    ping: jest.fn(async () => undefined),
    branchPhone: jest.fn(async () => ({
      phone: '+998901234567',
      number: 1001,
    })),
  };
  const ops = { alert: jest.fn(async () => undefined) };
  const sms = { send: jest.fn(async () => undefined) };
  const processor = new EscalationProcessor(
    prisma as any,
    transitions as any,
    restaurant as any,
    ops as any,
    sms as any,
  );
  const run = (name: string) =>
    processor.process({ name, data: { orderId: ORDER_ID } } as Job<{
      orderId: string;
    }>);
  return { run, transitions, restaurant, ops, sms };
}

describe('Escalation chain', () => {
  it('is 45 s Telegram ping, 120 s SMS; auto-cancel comes from the acceptance timeout', () => {
    expect(ESCALATION_STEPS).toEqual([
      { name: 'ping', afterSeconds: 45 },
      { name: 'sms', afterSeconds: 120 },
    ]);
  });

  it('skips esc-call jobs left in Redis from before the robocall step was dropped', async () => {
    const { run, transitions, restaurant, ops, sms } =
      setup('pending_acceptance');
    await run('esc-call');
    expect(ops.alert).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
    expect(restaurant.ping).not.toHaveBeenCalled();
    expect(transitions.transition).not.toHaveBeenCalled();
  });

  it('pings, texts the branch and cancels while the order waits for acceptance', async () => {
    const { run, transitions, restaurant, sms } = setup('pending_acceptance');
    await run('esc-ping');
    await run('esc-sms');
    await run('esc-cancel');
    expect(restaurant.ping).toHaveBeenCalledWith(ORDER_ID, 1);
    expect(sms.send).toHaveBeenCalledWith('+998901234567', expect.any(String));
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        to: 'cancelled',
        reason: 'no_response',
      }),
    );
  });

  it('does nothing once the restaurant has accepted', async () => {
    const { run, transitions, restaurant, sms } = setup('accepted');
    for (const name of ['esc-ping', 'esc-sms', 'esc-cancel']) await run(name);
    expect(restaurant.ping).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
    expect(transitions.transition).not.toHaveBeenCalled();
  });
});
