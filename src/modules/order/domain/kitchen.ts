import type { PrismaService } from 'src/modules/_prisma/prisma.service';
import { isPosLive } from 'src/modules/pos/domain/pos-steps';
import type { OrderSettingsService } from '../services/order-settings.service';
import type { FulfillmentName, OrderStatusName } from './order-state-machine';

/**
 * Who leads the kitchen steps of an order (docs/DELIVERY.md, "Статусы заказа" and "Окно оператора"; docs/IIKO.md,
 * "Путь заказа и статусы"):
 * - the venue's kitchen queue (trackPreparation): deliveries pass "preparing" like pickups; always on while iiko is
 *   connected, since iiko reports "cooking started";
 * - an order handed to iiko (pos_order sent) has its kitchen steps from iiko: the operator marks them only with an
 *   explicit override.
 */

export interface KitchenMode {
  /** Effective: the venue's setting, or iiko connected */
  trackPreparation: boolean;
  /** iiko connected (active or waiting for a reconnect) */
  posLive: boolean;
  /** Couriers of the venue work in iiko */
  posCouriers: boolean;
}

export function kitchenModeOf(
  setting: boolean,
  integration: { status: string; courier_mode: string } | null,
): KitchenMode {
  const posLive = isPosLive(integration?.status);
  return {
    trackPreparation: setting || posLive,
    posLive,
    posCouriers: posLive && integration?.courier_mode === 'iiko',
  };
}

/** The kitchen mode of a venue now (settings are cached for 30 s). */
export async function loadKitchenMode(
  prisma: Pick<PrismaService, 'pos_integration'>,
  settings: Pick<OrderSettingsService, 'get'>,
  organizationId: string,
): Promise<KitchenMode> {
  const [s, integration] = await Promise.all([
    settings.get(organizationId),
    prisma.pos_integration.findUnique({
      where: { organization_id: organizationId },
      select: { status: true, courier_mode: true },
    }),
  ]);
  return kitchenModeOf(s.trackPreparation, integration);
}

/**
 * iiko leads the order: the integration is connected and the order reached iiko (sent). Not when the transfer is
 * stuck (failed, needs_street: the operator acts), was entered by hand (manual) or has not finished yet.
 */
export const isPosControlled = (
  posLive: boolean,
  posState: string | null | undefined,
) => posLive && posState === 'sent';

/** A kitchen step: from accepted or preparing to preparing or ready. */
export const isKitchenStep = (from: OrderStatusName, to: OrderStatusName) =>
  (from === 'accepted' || from === 'preparing') &&
  (to === 'preparing' || to === 'ready') &&
  from !== to;

export type KitchenVerdict =
  | { ok: true; overridden: boolean }
  | { ok: false; reason: 'not_allowed' | 'pos_controlled' };

/**
 * The operator's kitchen step (actor restaurant) under the venue's mode. The state machine already allowed the
 * pair; this adds what depends on the venue:
 * - iiko leads the order: refused without `override`, done and marked with it;
 * - delivery without the kitchen queue: no "preparing" (an order already preparing still goes to ready, so turning
 *   the setting off never strands one);
 * - delivery with the kitchen queue: accepted → ready only through preparing (or with the iiko override).
 */
export function kitchenCheck(step: {
  from: OrderStatusName;
  to: OrderStatusName;
  fulfillment: FulfillmentName;
  trackPreparation: boolean;
  posControlled: boolean;
  override: boolean;
}): KitchenVerdict {
  if (!isKitchenStep(step.from, step.to))
    return { ok: true, overridden: false };
  if (step.posControlled && !step.override)
    return { ok: false, reason: 'pos_controlled' };
  const overridden = step.posControlled && step.override;
  if (step.fulfillment === 'delivery') {
    if (step.to === 'preparing' && !step.trackPreparation)
      return { ok: false, reason: 'not_allowed' };
    if (
      step.from === 'accepted' &&
      step.to === 'ready' &&
      step.trackPreparation &&
      !overridden
    )
      return { ok: false, reason: 'not_allowed' };
  }
  return { ok: true, overridden };
}
