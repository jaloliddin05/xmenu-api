import { createHash } from 'crypto';
import type { PosWebhookEvent } from '../provider/pos-provider';
import { iikoOrderInfo } from './iiko-order';

/**
 * One iiko webhook call is a JSON array of events `{ eventType, eventTime, organizationId,
 * correlationId, eventInfo }` (x-webhooks in the iiko OpenAPI spec). iiko repeats a call that was not
 * answered with 200, so the same event can arrive twice: its key is a hash of the whole event.
 * DeliveryOrderUpdate and DeliveryOrderError carry the order in `eventInfo` (iiko-order.ts).
 */
export function parseIikoWebhook(body: unknown): PosWebhookEvent[] {
  const list = Array.isArray(body) ? body : [body];
  const out: PosWebhookEvent[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.eventType !== 'string') continue;
    const info = (e.eventInfo ?? {}) as Record<string, unknown>;
    const updates = Array.isArray(info.terminalGroupsStopListsUpdates)
      ? (info.terminalGroupsStopListsUpdates as unknown[])
      : [];
    out.push({
      key: createHash('sha256')
        .update(
          JSON.stringify([
            e.eventType,
            e.organizationId ?? null,
            e.correlationId ?? null,
            e.eventTime ?? null,
            e.eventInfo ?? null,
          ]),
        )
        .digest('hex'),
      type: e.eventType,
      externalOrgId:
        typeof e.organizationId === 'string' ? e.organizationId : null,
      terminalGroupIds: updates.flatMap((u) =>
        u &&
        typeof u === 'object' &&
        typeof (u as { id?: unknown }).id === 'string'
          ? [(u as { id: string }).id]
          : [],
      ),
      order:
        e.eventType === 'DeliveryOrderUpdate' ||
        e.eventType === 'DeliveryOrderError'
          ? iikoOrderInfo(info)
          : null,
    });
  }
  return out;
}
