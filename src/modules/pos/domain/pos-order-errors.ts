/**
 * Why an order did not get into iiko (pos_order.error, docs/API.md "Передача заказа в iiko") and
 * whether another attempt with the same order id can help (docs/IIKO.md, "Ошибки и сбои").
 */
export type PosOrderReason =
  | 'pos_unavailable'
  | 'pos_not_taken'
  | 'pos_rejected_stop_list'
  | 'pos_rejected_price'
  | 'pos_rejected_data'
  | 'pos_key_invalid'
  | 'pos_module_missing'
  | 'pos_access_denied'
  | 'pos_access_blocked'
  | 'unmapped_branch'
  | 'unmapped_item'
  | 'unmapped_payment'
  | 'unmapped_delivery_item';

export interface PosFailure {
  reason: PosOrderReason;
  retry: boolean;
}

/** Attempts in one round: the first one and four retries */
export const POS_PUSH_ATTEMPTS = 5;
/** Pause before retry n (after attempt n): 1 + 2 + 3 + 4 minutes, the round ends within 10 minutes */
export const POS_RETRY_DELAYS_MS = [60_000, 120_000, 180_000, 240_000];

/** A failed call to iiko by the error code of the transport (iiko-api.client.ts, iikoStatusCode). */
export function callFailure(code: string): PosFailure {
  switch (code) {
    case 'pos_key_invalid':
    case 'pos_module_missing':
    case 'pos_access_denied':
    case 'pos_access_blocked':
      return { reason: code, retry: false };
    default:
      // No answer, a timeout, 5xx, 429: the same order id is safe to send again
      return { reason: 'pos_unavailable', retry: true };
  }
}

/**
 * iiko refused to create the order (errorInfo.code of the order, or the code of the failed command).
 * The codes are matched by meaning, as named in the iiko reference; the list is checked on a live
 * iiko before the pilot. The cash desk not taking the order in time is the only refusal repeated.
 */
export function creationFailure(errorCode: string | null): PosFailure {
  const code = errorCode ?? '';
  // The refusals first: a price code names the front too (RequestProductPriceIsNotEqualToFrontPrice)
  if (/stop.?list/i.test(code))
    return { reason: 'pos_rejected_stop_list', retry: false };
  if (/price/i.test(code))
    return { reason: 'pos_rejected_price', retry: false };
  if (/timeout|transport|terminal.*(offline|unavailable|alive)/i.test(code))
    return { reason: 'pos_not_taken', retry: true };
  if (!code) return { reason: 'pos_unavailable', retry: true };
  return { reason: 'pos_rejected_data', retry: false };
}

/** Delay before the next attempt, or null when the round is over. */
export function retryDelay(attemptsMade: number): number | null {
  if (attemptsMade >= POS_PUSH_ATTEMPTS) return null;
  return POS_RETRY_DELAYS_MS[attemptsMade - 1] ?? null;
}
