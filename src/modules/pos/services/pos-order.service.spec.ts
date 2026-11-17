import { AppException } from 'src/infra/errors/app-exception';
import { IikoApiError } from '../iiko/iiko-api.client';
import { fakePosOrderWorld, ORDER, ORG } from './pos-order.fake';
import { POS_CHECK_POLLS, PosOrderService } from './pos-order.service';

const success = (number = '1042') => ({
  correlationId: 'cid-1',
  info: {
    id: ORDER,
    creation: 'success' as const,
    errorCode: null,
    status: 'Unconfirmed' as const,
    number,
    courierName: null,
  },
});
const inProgress = { correlationId: 'cid-1', info: null };
const httpError = (status: number | null, code: string) =>
  new IikoApiError('/api/1/deliveries/create', status, null, code as never);

describe('PosOrderService', () => {
  let t: ReturnType<typeof fakePosOrderWorld>;
  let service: PosOrderService;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    env = { ...process.env };
    t = fakePosOrderWorld();
    service = new PosOrderService(
      t.prisma as any,
      t.provider as any,
      t.keyring,
      t.transitions as any,
      t.restaurant as any,
      t.queue as any,
    );
    service.sleep = async () => undefined;
  });

  afterEach(() => {
    process.env = env;
  });

  const pos = () => t.world.pos;
  const alerts = () =>
    t.restaurant.alertPos.mock.calls.map((c: any[]) => c[1].kind);

  describe('push', () => {
    it('sent at once: our order id, then confirmed; marked sent with the iiko number', async () => {
      t.provider.createOrder.mockResolvedValue(success());
      await service.push(ORDER);
      const [cred, orgId, draft] = t.provider.createOrder.mock.calls[0];
      expect(cred).toEqual({
        integrationId: 'int-1',
        apiKey: 'restaurant-key',
      });
      expect(orgId).toBe('iiko-org');
      expect(draft).toMatchObject({
        id: ORDER,
        externalNumber: '12',
        terminalGroupId: 'tg1',
        // "Delivery" carries the fee
        items: [
          { productId: 'i-pizza', price: 40_000 },
          { productId: 'i-delivery', price: 10_000 },
        ],
        payment: { paymentTypeId: 'pt-cash', sum: 50_000 },
      });
      expect(t.provider.confirmOrder).toHaveBeenCalledWith(
        expect.anything(),
        'iiko-org',
        ORDER,
      );
      expect(pos()).toMatchObject({
        state: 'sent',
        attempts: 1,
        pos_number: '1042',
        error: null,
      });
      expect(t.journal).toEqual(['iiko:sent']);
      expect(t.restaurant.alertPos).not.toHaveBeenCalled();
    });

    it('in progress: the command is checked; success then confirms', async () => {
      t.provider.createOrder.mockResolvedValue(inProgress);
      await service.push(ORDER);
      expect(pos()).toMatchObject({
        state: 'sending',
        correlation_id: 'cid-1',
      });
      expect(t.queue.check).toHaveBeenCalledWith(ORDER, 'cid-1', 0);

      t.provider.commandStatus.mockResolvedValue({ state: 'in_progress' });
      await service.check(ORDER, 'cid-1', 0);
      expect(t.queue.check).toHaveBeenLastCalledWith(ORDER, 'cid-1', 1);

      t.provider.commandStatus.mockResolvedValue({ state: 'success' });
      t.provider.orders.mockResolvedValue([success('77').info] as never);
      await service.check(ORDER, 'cid-1', 1);
      expect(pos()).toMatchObject({ state: 'sent', pos_number: '77' });
      expect(t.provider.confirmOrder).toHaveBeenCalledTimes(1);
    });

    it('a check of an older command or of a sent order does nothing', async () => {
      t.provider.createOrder.mockResolvedValue(inProgress);
      await service.push(ORDER);
      await service.check(ORDER, 'another', 0);
      expect(t.provider.commandStatus).not.toHaveBeenCalled();
    });

    it('iiko does not answer: retried with the same order id, alert once; after 5 attempts "not sent"', async () => {
      t.provider.createOrder.mockRejectedValue(
        httpError(null, 'pos_unavailable'),
      );
      const delays: number[] = [];
      t.queue.push.mockImplementation(
        async (_id: string, _n: number, d: number) => {
          delays.push(d);
        },
      );
      for (let i = 0; i < 5; i++) await service.push(ORDER);
      expect(t.provider.createOrder).toHaveBeenCalledTimes(5);
      const ids = new Set(
        t.provider.createOrder.mock.calls.map((c: any[]) => c[2].id),
      );
      expect([...ids]).toEqual([ORDER]);
      expect(delays).toEqual([60_000, 120_000, 180_000, 240_000]);
      expect(pos()).toMatchObject({
        state: 'failed',
        error: 'pos_unavailable',
        attempts: 5,
      });
      // One alert while retrying, one when it is over
      expect(alerts()).toEqual(['retrying', 'failed']);
      // The order stays accepted
      expect(t.world.order.status).toBe('accepted');
    });

    it('the cash desk did not take the order in time: retried like a failure', async () => {
      t.provider.createOrder.mockResolvedValue({
        correlationId: 'cid-1',
        info: {
          ...success().info,
          creation: 'error',
          errorCode: 'TimeoutOnFront',
        },
      });
      await service.push(ORDER);
      expect(pos()).toMatchObject({ state: 'queued', error: 'pos_not_taken' });
      expect(t.queue.push).toHaveBeenCalledWith(ORDER, 1, 60_000);
    });

    it('the command never finishes: the attempt counts as not taken', async () => {
      t.provider.createOrder.mockResolvedValue(inProgress);
      await service.push(ORDER);
      t.provider.commandStatus.mockResolvedValue({ state: 'in_progress' });
      await service.check(ORDER, 'cid-1', POS_CHECK_POLLS - 1);
      expect(pos()).toMatchObject({ state: 'queued', error: 'pos_not_taken' });
    });

    it.each([
      ['StopListedProduct', 'pos_rejected_stop_list'],
      ['RequestProductPriceIsNotEqualToFrontPrice', 'pos_rejected_price'],
      ['InvalidPhone', 'pos_rejected_data'],
    ])(
      'iiko refused (%s): no retry, the operator gets the reason %s',
      async (code, reason) => {
        t.provider.createOrder.mockResolvedValue(inProgress);
        await service.push(ORDER);
        t.provider.commandStatus.mockResolvedValue({
          state: 'error',
          errorCode: null,
        });
        t.provider.orders.mockResolvedValue([
          { ...success().info, creation: 'error', errorCode: code },
        ] as never);
        await service.check(ORDER, 'cid-1', 0);
        expect(pos()).toMatchObject({ state: 'failed', error: reason });
        expect(t.queue.push).not.toHaveBeenCalled();
        expect(t.restaurant.alertPos).toHaveBeenCalledWith(ORDER, {
          kind: 'failed',
          reason,
        });
      },
    );

    it.each([
      [402, 'pos_module_missing', 'delivery_module'],
      [403, 'pos_access_denied', 'key_access'],
      [423, 'pos_access_blocked', 'key_access'],
    ])(
      '%s: "not sent" at once with the reason, the status screen check turns red',
      async (status, code, check) => {
        t.provider.createOrder.mockRejectedValue(httpError(status, code));
        await service.push(ORDER);
        expect(pos()).toMatchObject({ state: 'failed', error: code });
        expect(t.queue.push).not.toHaveBeenCalled();
        expect(t.world.integration.checks).toContainEqual({
          key: check,
          status: 'fail',
          code,
        });
        expect(t.world.integration.status).toBe('active');
      },
    );

    it('the key was revoked: "needs reconnect", the venue alerted once; orders keep being accepted', async () => {
      t.provider.createOrder.mockRejectedValue(
        httpError(401, 'pos_key_invalid'),
      );
      await service.push(ORDER);
      expect(pos()).toMatchObject({
        state: 'failed',
        error: 'pos_key_invalid',
      });
      expect(t.world.integration.status).toBe('needs_reconnect');
      expect(t.restaurant.alertPosReconnect).toHaveBeenCalledWith(ORG);
      expect(t.world.order.status).toBe('accepted');
      // A second order failing the same way does not alert the venue again
      t.world.pos.state = 'queued';
      await service.push(ORDER);
      expect(t.restaurant.alertPosReconnect).toHaveBeenCalledTimes(1);
    });

    it('a dish without a link or an unlinked branch: "not sent", no call to iiko', async () => {
      t.prisma.pos_menu_link.findMany.mockResolvedValue([]);
      await service.push(ORDER);
      expect(pos()).toMatchObject({ state: 'failed', error: 'unmapped_item' });
      t.world.pos.state = 'queued';
      t.world.branchLink = null;
      await service.push(ORDER);
      expect(pos()).toMatchObject({
        state: 'failed',
        error: 'unmapped_branch',
      });
      expect(t.provider.createOrder).not.toHaveBeenCalled();
    });

    it('streets from the iiko directory: waits for the operator to pick one', async () => {
      t.world.integration.address_format = 'legacy';
      await service.push(ORDER);
      expect(pos().state).toBe('needs_street');
      expect(alerts()).toEqual(['needs_street']);
      expect(t.provider.createOrder).not.toHaveBeenCalled();
    });

    it('cancelled while waiting for the retry: nothing is sent', async () => {
      t.world.order.status = 'cancelled';
      await service.push(ORDER);
      expect(t.provider.createOrder).not.toHaveBeenCalled();
    });

    it('an alert was sent and it went through after all: the operator is told', async () => {
      t.provider.createOrder.mockRejectedValueOnce(
        httpError(null, 'pos_unavailable'),
      );
      await service.push(ORDER);
      t.provider.createOrder.mockResolvedValue(success());
      await service.push(ORDER);
      expect(alerts()).toEqual(['retrying', 'sent']);
      expect(pos().state).toBe('sent');
    });

    it('a webhook with the creation result settles an order being sent', async () => {
      t.provider.createOrder.mockResolvedValue(inProgress);
      await service.push(ORDER);
      await service.creationReported({
        ...success().info,
        creation: 'error',
        errorCode: 'StopListedProduct',
      });
      expect(pos()).toMatchObject({
        state: 'failed',
        error: 'pos_rejected_stop_list',
      });
      // The check job that comes later finds nothing to do
      await service.check(ORDER, 'cid-1', 0);
      expect(t.provider.commandStatus).not.toHaveBeenCalled();
    });
  });

  describe('the operator', () => {
    beforeEach(() => {
      Object.assign(t.world.pos, {
        state: 'failed',
        error: 'pos_unavailable',
        attempts: 5,
        alerted: 'failed',
      });
    });

    it('«Повторить»: a new round of 5 attempts, journaled with the staff member', async () => {
      const view = await service.retry(ORG, ORDER, 'staff-1');
      expect(view).toMatchObject({ state: 'queued', attempts: 0, error: null });
      expect(t.queue.push).toHaveBeenCalledWith(
        ORDER,
        0,
        0,
        expect.any(String),
      );
      expect(t.transitions.recordInTx).toHaveBeenCalledWith(expect.anything(), {
        orderId: ORDER,
        status: 'accepted',
        actor: 'restaurant',
        actorId: 'staff-1',
        note: 'iiko:retry_by_staff',
      });
    });

    it('«Повторить» only for an order not sent, and not for a finished order', async () => {
      t.world.pos.state = 'sent';
      await expect(service.retry(ORG, ORDER, 's')).rejects.toMatchObject({
        code: 'pos_order_state_conflict',
      });
      t.world.pos.state = 'failed';
      t.world.order.status = 'completed';
      await expect(service.retry(ORG, ORDER, 's')).rejects.toMatchObject({
        code: 'pos_order_state_conflict',
      });
    });

    it('«Внесён вручную» with the iiko number: no more attempts', async () => {
      const view = await service.manual(ORG, ORDER, '555', 'staff-1');
      expect(view).toMatchObject({ state: 'manual', posNumber: '555' });
      expect(pos().manual_by).toBe('staff-1');
      await expect(
        service.manual(ORG, ORDER, null, 'staff-1'),
      ).rejects.toMatchObject({ code: 'pos_order_state_conflict' });
      // A retry still waiting in the queue does nothing now
      await service.push(ORDER);
      expect(t.provider.createOrder).not.toHaveBeenCalled();
    });

    it('another venue: 404; an order without iiko: pos_not_connected', async () => {
      await expect(service.retry('org-2', ORDER, 's')).rejects.toMatchObject({
        code: 'not_found',
      });
      t.prisma.pos_order.findUnique.mockResolvedValueOnce(null);
      const e = await service.retry(ORG, ORDER, 's').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('pos_not_connected');
    });

    it('the street: listed only while the order waits for one; picking it sends the order', async () => {
      await expect(service.streets(ORG, ORDER, 'tem')).rejects.toMatchObject({
        code: 'pos_order_state_conflict',
      });
      t.world.pos.state = 'needs_street';
      t.provider.streets.mockResolvedValue([
        { id: 'st-1', name: 'Amir Temur', city: 'Tashkent' },
      ] as never);
      expect(await service.streets(ORG, ORDER, 'tem')).toHaveLength(1);
      await service.setStreet(
        ORG,
        ORDER,
        { streetId: 'st-1', house: '12A' },
        'staff-1',
      );
      expect(pos()).toMatchObject({
        state: 'queued',
        street_id: 'st-1',
        house: '12A',
        attempts: 0,
      });
      expect(t.queue.push).toHaveBeenCalled();

      // The next attempt passes the street
      t.world.integration.address_format = 'legacy';
      t.provider.createOrder.mockResolvedValue(success());
      await service.push(ORDER);
      expect(t.provider.createOrder.mock.calls[0][2].address).toMatchObject({
        format: 'legacy',
        streetId: 'st-1',
        house: '12A',
      });
    });

    it('the street list keeps iiko failures neutral', async () => {
      t.world.pos.state = 'needs_street';
      t.provider.streets.mockRejectedValue(
        new IikoApiError('/api/1/cities', 503, null, 'pos_unavailable'),
      );
      await expect(service.streets(ORG, ORDER, '')).rejects.toMatchObject({
        code: 'pos_unavailable',
      });
    });
  });

  describe('own couriers delivered', () => {
    beforeEach(() => {
      Object.assign(t.world.pos, { state: 'sent', delivered_push: 'pending' });
      t.world.order.status = 'completed';
    });

    it('OnWay, then Delivered, each waiting for its command', async () => {
      t.provider.setDeliveryStatus
        .mockResolvedValueOnce('c-onway')
        .mockResolvedValueOnce('c-delivered');
      t.provider.commandStatus
        .mockResolvedValueOnce({ state: 'in_progress' })
        .mockResolvedValue({ state: 'success' });
      await service.delivered(ORDER);
      expect(
        t.provider.setDeliveryStatus.mock.calls.map((c: any[]) => c[3]),
      ).toEqual(['OnWay', 'Delivered']);
      expect(pos().delivered_push).toBe('done');
      expect(t.journal).toEqual(['iiko:OnWay', 'iiko:Delivered']);
    });

    it('iiko refuses Delivered: journal and alert, a retry goes on from there', async () => {
      t.provider.setDeliveryStatus.mockResolvedValue('c');
      t.provider.commandStatus
        .mockResolvedValueOnce({ state: 'success' })
        .mockResolvedValueOnce({ state: 'error', errorCode: null });
      await service.delivered(ORDER);
      expect(pos().delivered_push).toBe('failed');
      expect(t.journal).toEqual(['iiko:OnWay', 'iiko:Delivered:failed']);
      expect(alerts()).toEqual(['delivered_push_failed']);
      expect(t.world.order.status).toBe('completed');

      // Continues from "on the way" if asked again
      t.world.pos.delivered_push = 'on_way';
      t.provider.setDeliveryStatus.mockClear();
      t.provider.commandStatus.mockResolvedValue({ state: 'success' });
      await service.delivered(ORDER);
      expect(
        t.provider.setDeliveryStatus.mock.calls.map((c: any[]) => c[3]),
      ).toEqual(['Delivered']);
      expect(pos().delivered_push).toBe('done');
    });

    it('an order that is not in iiko is left alone', async () => {
      t.world.pos.state = 'manual';
      await service.delivered(ORDER);
      expect(t.provider.setDeliveryStatus).not.toHaveBeenCalled();
    });
  });
});
