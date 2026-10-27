import type {
  customer_order,
  customer_order_item,
  customer_order_item_option,
} from '@prisma/client';

export type OrderWithItems = customer_order & {
  items: (customer_order_item & { options: customer_order_item_option[] })[];
  branch: { id: string; title: string; address: string };
};

export interface OrderViewOptions {
  /** Faqat awaiting_payment holatida beriladi (to'lov havolasi) */
  paymentUrl?: string | null;
  failReason?: 'declined' | 'expired' | 'cancelled' | null;
}

/**
 * Buyurtma → JSON (docs/ORDERS_API.md "Объект заказа"). Barcha pozitsiyalar,
 * manzil va filial — buyurtma vaqtidagi snapshot.
 */
export function toOrderView(order: OrderWithItems, opts: OrderViewOptions = {}) {
  const online = order.payment_method !== 'cash';

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    fulfillmentMode: order.fulfillment,
    createdAt: order.created_at.toISOString(),
    branchId: order.branch_id,
    branch: { id: order.branch.id, title: order.branch.title, address: order.branch.address },
    address: order.address_snapshot ?? null,
    phone: order.phone,
    comment: order.comment ?? '',
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    payment: online
      ? {
          url: order.status === 'awaiting_payment' ? (opts.paymentUrl ?? null) : null,
          expiresAt: order.payment_expires_at ? order.payment_expires_at.toISOString() : null,
          failReason: order.status === 'payment_failed' ? (opts.failReason ?? 'declined') : null,
        }
      : null,
    items: [...order.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        itemId: item.product_id ?? item.id,
        name: item.name,
        image: item.image,
        weight: item.weight ?? '',
        currency: order.currency,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        modifiers: groupModifiers(item.options),
      })),
    currency: order.currency,
    subtotal: order.subtotal,
    serviceFee: order.service_fee,
    discount: order.discount,
    total: order.total,
    etaMinutes: [order.eta_min, order.eta_max],
    cancelledBy: order.cancelled_by && order.cancelled_by !== 'payment' ? order.cancelled_by : null,
    cancelReason: order.cancel_reason,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;

function groupModifiers(options: customer_order_item_option[]) {
  const groups = new Map<string, { groupId: string; groupTitle: string; options: { id: string; name: string; price: number }[] }>();
  for (const o of [...options].sort((a, b) => a.position - b.position)) {
    const key = o.group_id ?? o.group_title;
    let g = groups.get(key);
    if (!g) {
      g = { groupId: o.group_id ?? '', groupTitle: o.group_title, options: [] };
      groups.set(key, g);
    }
    g.options.push({ id: o.option_id ?? o.id, name: o.name, price: o.price });
  }
  return [...groups.values()];
}
