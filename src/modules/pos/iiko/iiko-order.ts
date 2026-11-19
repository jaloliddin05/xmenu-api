import type {
  PosDeliveryStatus,
  PosOrderDraft,
  PosOrderInfo,
} from '../provider/pos-provider';

/** Seconds iiko waits for the cash desk to take the order (iiko default: 8) */
export const TRANSPORT_TO_FRONT_TIMEOUT_SECONDS = 8;

const DELIVERY_STATUSES: readonly PosDeliveryStatus[] = [
  'Unconfirmed',
  'WaitCooking',
  'ReadyForCooking',
  'CookingStarted',
  'CookingCompleted',
  'Waiting',
  'OnWay',
  'Delivered',
  'Closed',
  'Cancelled',
];

/**
 * Body of POST /api/1/deliveries/create (iiko OpenAPI: DeliveryOrder). Only the guest data the
 * kitchen and the delivery need: name, phone, address, comment.
 */
export function iikoCreateBody(orgId: string, order: PosOrderDraft) {
  const address = order.address;
  return {
    organizationId: orgId,
    terminalGroupId: order.terminalGroupId,
    createOrderSettings: {
      transportToFrontTimeout: TRANSPORT_TO_FRONT_TIMEOUT_SECONDS,
      checkStopList: true,
    },
    order: {
      id: order.id,
      externalNumber: order.externalNumber,
      // The price category of the venue (decision 4): iiko prices the order like the menu imported
      ...(order.priceCategoryId
        ? { priceCategoryId: order.priceCategoryId }
        : {}),
      phone: order.phone,
      orderServiceType:
        order.kind === 'delivery' ? 'DeliveryByCourier' : 'DeliveryByClient',
      customer: { type: 'one-time', name: order.customerName },
      comment: order.comment,
      deliveryPoint: address
        ? {
            coordinates:
              address.latitude != null && address.longitude != null
                ? {
                    latitude: address.latitude,
                    longitude: address.longitude,
                  }
                : null,
            address:
              address.format === 'city'
                ? {
                    type: 'city',
                    line1: address.line.slice(0, 250),
                    entrance: address.entrance,
                    floor: address.floor,
                    flat: address.flat,
                  }
                : {
                    type: 'legacy',
                    street: { id: address.streetId },
                    house: address.house,
                    entrance: address.entrance,
                    floor: address.floor,
                    flat: address.flat,
                  },
            comment: address.comment,
          }
        : null,
      items: order.items.map((i) => ({
        type: 'Product',
        productId: i.productId,
        productSizeId: i.sizeId,
        amount: i.amount,
        price: i.price,
        modifiers: i.modifiers.map((m) => ({
          productId: m.productId,
          productGroupId: m.groupId,
          amount: m.amount,
          price: m.price,
        })),
      })),
      payments: [
        {
          paymentTypeKind: order.payment.paymentTypeKind,
          paymentTypeId: order.payment.paymentTypeId,
          sum: order.payment.sum,
          isProcessedExternally: order.payment.processedExternally,
        },
      ],
    },
  };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function creation(v: unknown): PosOrderInfo['creation'] {
  switch (v) {
    case 'InProgress':
      return 'in_progress';
    case 'Success':
      return 'success';
    case 'Error':
    case 'Cancelled':
      return 'error';
    default:
      return null;
  }
}

/**
 * An order of iiko (OrderInfo of deliveries/create and by_id, eventInfo of DeliveryOrderUpdate and
 * DeliveryOrderError): `{ id, creationStatus, errorInfo: { code }, order: { number, status,
 * courierInfo: { courier: { name } } } }`. Null without an id.
 */
export function iikoOrderInfo(raw: unknown): PosOrderInfo | null {
  const info = obj(raw);
  const id = str(info.id);
  if (!id) return null;
  const order = obj(info.order);
  const status = DELIVERY_STATUSES.find((s) => s === order.status) ?? null;
  const courier = obj(obj(order.courierInfo).courier);
  return {
    id,
    creation: creation(info.creationStatus),
    errorCode: str(obj(info.errorInfo).code)?.slice(0, 80) ?? null,
    status,
    number: str(order.number),
    courierName: str(courier.name)?.slice(0, 120) ?? null,
  };
}
