import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';

/**
 * Who physically delivers an order (docs/DELIVERY.md, "Решения"). Every way of delivering sits behind this
 * interface: the venue's own couriers now (OwnCouriersProvider), external services (Noor, Yandex, Millennium)
 * later as more adapters, when their APIs are available. Order statuses still move only through
 * OrderTransitionService; a provider reports and reacts, it never writes a status itself.
 */
export type DeliveryProviderKind = 'own_couriers';

export interface DeliveryProviderStatus {
  provider: DeliveryProviderKind;
  /** unassigned: waits for a courier; assigned: the courier has not picked it up; then picked_up, at_door, delivered */
  stage:
    | 'unassigned'
    | 'assigned'
    | 'picked_up'
    | 'at_door'
    | 'delivered'
    | 'closed';
  courier: { id: string; name: string } | null;
  orderStatus: OrderStatusName;
}

export interface DeliveryProvider {
  readonly kind: DeliveryProviderKind;
  /** The order needs delivery (it was accepted): own couriers wait for the operator to assign one. */
  create(organizationId: string, orderId: string): Promise<void>;
  /** The order no longer needs this provider (cancelled, returned, handed over): free the courier. */
  cancel(
    organizationId: string,
    orderId: string,
    actorId: string,
  ): Promise<void>;
  status(
    organizationId: string,
    orderId: string,
  ): Promise<DeliveryProviderStatus>;
  /** An update from the provider's side (own couriers: the venue bot); false when it is not for this provider. */
  handleUpdate(update: unknown, context: unknown): Promise<boolean>;
}
