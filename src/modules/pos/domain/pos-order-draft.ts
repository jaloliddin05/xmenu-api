import type {
  PosOrderAddress,
  PosOrderDraft,
  PosOrderLine,
} from '../provider/pos-provider';

/** An accepted order as it is read for the POS. */
export interface DraftSource {
  id: string;
  number: number;
  fulfillment: 'delivery' | 'pickup';
  phone: string;
  comment: string | null;
  customerName: string | null;
  paymentMethod: 'cash' | 'card' | 'click' | 'payme';
  paymentStatus: string;
  total: number;
  deliveryFee: number;
  address: unknown;
  items: {
    productId: string | null;
    basePrice: number;
    quantity: number;
    options: { optionId: string | null; price: number }[];
  }[];
}

/** The integration's links an order needs (pos_branch_link, pos_payment_link, pos_menu_link). */
export interface DraftLinks {
  terminalGroupId: string;
  addressFormat: 'city' | 'legacy' | 'unknown' | null;
  /** Picked by the operator when the organization takes streets from the iiko directory */
  street: { id: string; house: string } | null;
  /** product id → iiko item and its single size */
  products: ReadonlyMap<string, { externalId: string; sizeId: string | null }>;
  /** option id → a size of the item or a modifier (pos_menu_link of kind size / modifier) */
  options: ReadonlyMap<
    string,
    { kind: 'size' | 'modifier'; externalId: string; sizeId: string | null }
  >;
  payments: ReadonlyMap<
    'cash' | 'card' | 'online',
    { id: string; kind: string }
  >;
  deliveryItem: { id: string; sizeId: string | null } | null;
}

/** Why an order cannot be built (the operator sees it, docs/API.md "Передача заказа в iiko"). */
export type DraftProblem =
  | 'unmapped_branch'
  | 'unmapped_item'
  | 'unmapped_payment'
  | 'unmapped_delivery_item'
  | 'needs_street';

export type DraftResult =
  | { ok: true; draft: PosOrderDraft }
  | { ok: false; problem: DraftProblem };

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const coord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** iiko payment of an Xmenu payment method: Click and Payme are "online". */
export const posPaymentMethod = (
  method: DraftSource['paymentMethod'],
): 'cash' | 'card' | 'online' =>
  method === 'click' || method === 'payme' ? 'online' : method;

/**
 * Builds the order iiko gets (docs/IIKO.md, "Путь заказа и статусы"): the external-menu positions
 * with the prices of the order (the price category of the branch was the one imported), the service
 * item "Delivery" when the fee is above zero, the payment through its link, the address in the way
 * the organization takes it and only the guest data the kitchen and the delivery need.
 */
export function buildPosOrder(
  order: DraftSource,
  links: DraftLinks,
): DraftResult {
  const items: PosOrderLine[] = [];
  for (const item of order.items) {
    const product = item.productId ? links.products.get(item.productId) : null;
    if (!product) return { ok: false, problem: 'unmapped_item' };
    let sizeId = product.sizeId;
    // A size option is part of the item price in iiko; other options are modifiers
    let price = item.basePrice;
    const modifiers: PosOrderLine['modifiers'] = [];
    for (const option of item.options) {
      const link = option.optionId ? links.options.get(option.optionId) : null;
      if (!link) return { ok: false, problem: 'unmapped_item' };
      if (link.kind === 'size') {
        sizeId = link.sizeId;
        price += option.price;
        continue;
      }
      // pos_menu_link external id of a modifier: <itemId>/<groupId>/<modifierId>
      const [, groupId, modifierId] = link.externalId.split('/');
      if (!modifierId) return { ok: false, problem: 'unmapped_item' };
      modifiers.push({
        productId: modifierId,
        // A group without an iiko id was named <itemId>#<n> by the import
        groupId: groupId.includes('#') ? '' : groupId,
        amount: 1,
        price: option.price,
      });
    }
    items.push({
      productId: product.externalId,
      sizeId,
      amount: item.quantity,
      price,
      modifiers,
    });
  }

  if (order.deliveryFee > 0) {
    if (!links.deliveryItem)
      return { ok: false, problem: 'unmapped_delivery_item' };
    items.push({
      productId: links.deliveryItem.id,
      sizeId: links.deliveryItem.sizeId,
      amount: 1,
      price: order.deliveryFee,
      modifiers: [],
    });
  }

  const method = posPaymentMethod(order.paymentMethod);
  const payment = links.payments.get(method);
  if (!payment) return { ok: false, problem: 'unmapped_payment' };

  let address: PosOrderAddress | null = null;
  if (order.fulfillment === 'delivery') {
    const a = (order.address ?? {}) as Record<string, unknown>;
    const common = {
      latitude: coord(a.latitude),
      longitude: coord(a.longitude),
      entrance: text(a.entrance),
      floor: text(a.floor),
      flat: text(a.apartment),
      comment: text(a.comment),
    };
    if (links.addressFormat === 'city')
      address = { ...common, format: 'city', line: text(a.address) ?? '' };
    else if (links.street)
      address = {
        ...common,
        format: 'legacy',
        streetId: links.street.id,
        house: links.street.house,
      };
    // A street from the iiko directory (or a format that could not be read): the operator picks it
    else return { ok: false, problem: 'needs_street' };
  }

  return {
    ok: true,
    draft: {
      id: order.id,
      externalNumber: String(order.number),
      terminalGroupId: links.terminalGroupId,
      kind: order.fulfillment,
      phone: order.phone,
      customerName: text(order.customerName) ?? `Xmenu #${order.number}`,
      comment: text(order.comment),
      items,
      payment: {
        paymentTypeId: payment.id,
        paymentTypeKind: payment.kind,
        sum: order.total,
        processedExternally:
          method === 'online' && order.paymentStatus === 'paid',
      },
      address,
    },
  };
}
