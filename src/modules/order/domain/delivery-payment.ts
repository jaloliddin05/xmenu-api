/**
 * Payment methods of an order and which of them a venue offers at delivery (docs/DELIVERY.md, "Настройки"):
 * the venue switches cash, a card to the courier and online on and off; cash and card are paid at the door,
 * so they need own couriers (an external service collects nothing for the venue); online needs a connected
 * provider. Pickup is not governed by these settings.
 */
export const PAYMENT_METHODS = ['cash', 'card', 'click', 'payme'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ONLINE_PROVIDERS = ['click', 'payme'] as const;
export type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];

/** The kinds the venue switches on and off, and the guest sees in GET /tenant/config */
export const DELIVERY_PAYMENT_KINDS = ['cash', 'card', 'online'] as const;
export type DeliveryPaymentKind = (typeof DELIVERY_PAYMENT_KINDS)[number];

export interface DeliveryPaymentSettings {
  cash: boolean;
  card: boolean;
  online: boolean;
}

/** Cash or a card to the courier: paid at the door, no online payment step */
export const paidAtDoor = (method: string): method is 'cash' | 'card' =>
  method === 'cash' || method === 'card';

export const isOnlineMethod = (method: string): method is OnlineProvider =>
  (ONLINE_PROVIDERS as readonly string[]).includes(method);

/** What the guest may choose for a delivery now: the venue's switches narrowed by who delivers and the keys */
export function deliveryPaymentMethods(
  settings: {
    courierMode: 'own' | 'external' | 'both';
    deliveryPayment: DeliveryPaymentSettings;
  },
  providers: ReadonlySet<string>,
): PaymentMethod[] {
  const atDoor = settings.courierMode !== 'external';
  const out: PaymentMethod[] = [];
  if (atDoor && settings.deliveryPayment.cash) out.push('cash');
  if (atDoor && settings.deliveryPayment.card) out.push('card');
  if (settings.deliveryPayment.online)
    out.push(...ONLINE_PROVIDERS.filter((p) => providers.has(p)));
  return out;
}

/** The same list as kinds, without provider names (GET /tenant/config) */
export function deliveryPaymentKinds(
  methods: readonly PaymentMethod[],
): DeliveryPaymentKind[] {
  return DELIVERY_PAYMENT_KINDS.filter((k) =>
    k === 'online'
      ? methods.some(isOnlineMethod)
      : methods.includes(k as PaymentMethod),
  );
}

/** Pickup: cash always (paid at the counter), online with a connected provider */
export function pickupPaymentMethods(
  providers: ReadonlySet<string>,
): PaymentMethod[] {
  return ['cash', ...ONLINE_PROVIDERS.filter((p) => providers.has(p))];
}

/**
 * Saving the switches: online needs a connected provider; at least one method must stay on. A provider
 * disabled later does not change the switches, online just drops out of deliveryPaymentMethods.
 */
export function deliveryPaymentProblems(
  next: DeliveryPaymentSettings,
  previous: DeliveryPaymentSettings,
  hasProvider: boolean,
): { field: string; code: string; message: string }[] {
  const problems: { field: string; code: string; message: string }[] = [];
  if (next.online && !previous.online && !hasProvider)
    problems.push({
      field: 'deliveryPayment.online',
      code: 'online_payment_not_connected',
      message: 'Online payment is not connected',
    });
  if (!next.cash && !next.card && !next.online)
    problems.push({
      field: 'deliveryPayment',
      code: 'delivery_payment_required',
      message: 'At least one payment method is required',
    });
  return problems;
}

/** Cash and card the venue takes at the door now (none while only external services deliver) */
export const doorPaymentMethods = (settings: {
  courierMode: 'own' | 'external' | 'both';
  deliveryPayment: DeliveryPaymentSettings;
}): ('cash' | 'card')[] =>
  deliveryPaymentMethods(settings, new Set()).filter(paidAtDoor);

/**
 * What the courier may mark at the door: the method the guest chose first, then the other one the venue
 * takes now (the guest decides at the door). Online orders: none, the courier just delivers.
 */
export function doorPaymentChoices(
  paymentMethod: string,
  doorMethods: readonly ('cash' | 'card')[],
): ('cash' | 'card')[] {
  if (!paidAtDoor(paymentMethod)) return [];
  const other = paymentMethod === 'cash' ? 'card' : 'cash';
  return doorMethods.includes(other) ? [paymentMethod, other] : [paymentMethod];
}
