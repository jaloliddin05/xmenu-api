import { OrderWithItems, toOrderView } from './order-view';

const base = (over: Partial<OrderWithItems> = {}): OrderWithItems =>
  ({
    id: 'o1', number: 1042, organization_id: 'org', customer_id: 'c', branch_id: 'b1',
    status: 'awaiting_payment', fulfillment: 'delivery', version: 0,
    idempotency_key: 'k', request_hash: 'h', phone: '+998901234567', comment: null,
    address_snapshot: { id: 'a1', address: 'Street 1' },
    payment_method: 'click', payment_status: 'pending', payment_expires_at: new Date('2026-10-10T10:15:00Z'),
    currency: 'UZS', subtotal: 97000, service_fee: 16000, discount: 0, total: 113000,
    eta_min: 20, eta_max: 30, cancelled_by: null, cancel_reason: null, cancelled_at: null,
    placed_at: null, accepted_at: null, completed_at: null, tg_chat_id: null, tg_message_id: null,
    created_at: new Date('2026-10-10T10:00:00Z'), updated_at: new Date('2026-10-10T10:00:00Z'),
    branch: { id: 'b1', title: 'Mant 24/7', address: 'Tashkent' },
    items: [
      {
        id: 'i1', order_id: 'o1', product_id: 'p1', name: 'Мант', image: '/m.png', weight: '800 г',
        base_price: 45000, unit_price: 48500, quantity: 2, position: 0,
        options: [
          { id: 'x2', item_id: 'i1', group_id: 'g2', group_title: 'Сироп', option_id: 'o3', name: 'Катык', price: 3500, position: 2 },
          { id: 'x1', item_id: 'i1', group_id: 'g1', group_title: 'Добавки', option_id: 'o1', name: 'Лазжон', price: 0, position: 0 },
          { id: 'x1b', item_id: 'i1', group_id: 'g1', group_title: 'Добавки', option_id: 'o2', name: 'Катык', price: 3500, position: 1 },
        ],
      },
    ],
    ...over,
  }) as OrderWithItems;

describe('toOrderView', () => {
  it('maps the order into the documented API shape', () => {
    const v = toOrderView(base(), { paymentUrl: 'https://pay/x' });
    expect(v).toMatchObject({
      id: 'o1', number: 1042, status: 'awaiting_payment', fulfillmentMode: 'delivery',
      branchId: 'b1', branch: { id: 'b1', title: 'Mant 24/7' },
      paymentMethod: 'click', paymentStatus: 'pending',
      subtotal: 97000, serviceFee: 16000, discount: 0, total: 113000, etaMinutes: [20, 30],
      comment: '', cancelledBy: null,
    });
    expect(v.payment).toEqual({ url: 'https://pay/x', expiresAt: '2026-10-10T10:15:00.000Z', failReason: null });
  });

  it('groups modifiers by group in position order', () => {
    const [item] = toOrderView(base()).items;
    expect(item).toMatchObject({ itemId: 'p1', name: 'Мант', quantity: 2, unitPrice: 48500 });
    expect(item.modifiers).toEqual([
      { groupId: 'g1', groupTitle: 'Добавки', options: [{ id: 'o1', name: 'Лазжон', price: 0 }, { id: 'o2', name: 'Катык', price: 3500 }] },
      { groupId: 'g2', groupTitle: 'Сироп', options: [{ id: 'o3', name: 'Катык', price: 3500 }] },
    ]);
  });

  it('the payment link is only exposed while awaiting payment', () => {
    expect(toOrderView(base({ status: 'pending_acceptance' }), { paymentUrl: 'https://pay/x' }).payment?.url).toBeNull();
  });

  it('payment_failed carries the reason', () => {
    expect(toOrderView(base({ status: 'payment_failed' }), { failReason: 'expired' }).payment?.failReason).toBe('expired');
    expect(toOrderView(base({ status: 'payment_failed' })).payment?.failReason).toBe('declined');
  });

  it('cash orders have no payment object; "payment" actor is reported as system-less', () => {
    expect(toOrderView(base({ payment_method: 'cash', payment_status: 'not_required' })).payment).toBeNull();
    expect(toOrderView(base({ status: 'cancelled', cancelled_by: 'payment' })).cancelledBy).toBeNull();
    expect(toOrderView(base({ status: 'cancelled', cancelled_by: 'restaurant', cancel_reason: 'declined' }))).toMatchObject({ cancelledBy: 'restaurant', cancelReason: 'declined' });
  });
});
