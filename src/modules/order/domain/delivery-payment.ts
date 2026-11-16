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

/** Who delivers and the switches: all deliveryPaymentMethods needs besides the keys */
export interface DeliveryPaymentState {
  courierMode: 'own' | 'external' | 'both';
  deliveryPayment: DeliveryPaymentSettings;
}

/** Cash or a card to the courier: paid at the door, no online payment step */
export const paidAtDoor = (method: string): method is 'cash' | 'card' =>
  method === 'cash' || method === 'card';

export const isOnlineMethod = (method: string): method is OnlineProvider =>
  (ONLINE_PROVIDERS as readonly string[]).includes(method);

/** What the guest may choose for a delivery now: the venue's switches narrowed by who delivers and the keys */
export function deliveryPaymentMethods(
  settings: DeliveryPaymentState,
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
 * Saving the switches or the courier mode (the state after the save): online cannot be switched on without
 * a connected provider; at least one switch must stay on; and the guest must be left at least one method
 * (W13F-04): online only with a provider, cash and card not while only external services deliver.
 * The field names the cause: the courier mode when cash or card are on but nobody collects them.
 */
export function deliveryPaymentProblems(
  next: DeliveryPaymentState,
  previous: DeliveryPaymentSettings,
  providers: ReadonlySet<string>,
): { field: string; code: string; message: string }[] {
  const { deliveryPayment: pay } = next;
  const problems: { field: string; code: string; message: string }[] = [];
  if (pay.online && !previous.online && providers.size === 0)
    problems.push({
      field: 'deliveryPayment.online',
      code: 'online_payment_not_connected',
      message: 'Online payment is not connected',
    });
  if (!pay.cash && !pay.card && !pay.online)
    problems.push({
      field: 'deliveryPayment',
      code: 'delivery_payment_required',
      message: 'At least one payment method is required',
    });
  if (!problems.length && !deliveryPaymentMethods(next, providers).length)
    problems.push({
      field:
        next.courierMode === 'external' && (pay.cash || pay.card)
          ? 'courierMode'
          : 'deliveryPayment',
      code: 'delivery_payment_none_available',
      message: 'No payment method would be left at delivery',
    });
  return problems;
}

/**
 * Disabling a provider: refused when it takes away the last method the guest has at delivery. A state
 * that already offers nothing is not made worse by it, so it is not refused (the checklist reports it).
 */
export const providerDisableLeavesNoMethod = (
  state: DeliveryPaymentState,
  providers: ReadonlySet<string>,
  provider: string,
): boolean =>
  deliveryPaymentMethods(state, providers).length > 0 &&
  deliveryPaymentMethods(
    state,
    new Set([...providers].filter((p) => p !== provider)),
  ).length === 0;

/** Cash and card the venue takes at the door now (none while only external services deliver) */
export const doorPaymentMethods = (
  settings: DeliveryPaymentState,
): ('cash' | 'card')[] =>
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
