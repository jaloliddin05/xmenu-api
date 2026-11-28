/**
 * Live events (server-sent events): thin signals that something changed, never the data itself and never guest
 * personal data. A front-end refetches what the event names. Contract: docs/API.md, "События (SSE)".
 */
export type LiveEventType =
  /** A new order reached the venue (pending_acceptance): the board refetches, the signal plays */
  | 'order.created'
  /** Any committed change of an order: status, courier, POS state */
  | 'order.changed'
  /** A time-based attention mark appeared (delivery timers): the board refetches */
  | 'order.attention'
  /** Couriers list or shifts changed (shift opened or closed, courier added, disabled, load changed) */
  | 'courier.changed'
  /** A branch chat was bound by the platform bot */
  | 'branch.chat_bound'
  /** Venue data changed by a staff action or by the platform: the dashboard refetches what is on screen */
  | 'org.changed'
  /** The iiko integration changed (status, courier mode, menu import finished) */
  | 'pos.changed'
  /** Public data of the venue changed and the cached pages are already refreshed: open guest pages refetch */
  | 'content.changed'
  /** A phone confirmation through the venue bot moved on (contact shared, code sent, failed): one status call */
  | 'verification.changed';

/** Streams an event goes to. */
export type LiveAudience = 'staff' | 'guest' | 'public' | 'verification';

/** What is stored in the venue log and fanned out to every API process. */
export interface LiveEnvelope {
  type: LiveEventType;
  data: Record<string, unknown>;
  to: LiveAudience[];
  /** Staff stream filter: an event of another branch is not sent to a stream opened with ?branchId */
  branchId?: string | null;
  /** Guest stream filter: only the guest's own orders. Never sent out */
  customerId?: string | null;
  /** Verification stream filter: sha256 of the session id. Never sent out */
  session?: string | null;
  /** The browser tab that caused a staff change (X-Live-Origin): the tab already refetched and skips it */
  origin?: string | null;
}

/** A stored event with its id (the Redis stream id, also the SSE id). */
export interface LiveEvent {
  id: string;
  envelope: LiveEnvelope;
}

export type CloseReason = 'token_expired' | 'revoked' | 'finished';

/** How long missed events are kept for Last-Event-ID; an older id gets `resync`. */
export const LIVE_BUFFER_MS = 5 * 60_000;
/** The heartbeat comment: keeps proxies and mobile networks from cutting a quiet stream. */
export const LIVE_HEARTBEAT_MS = 25_000;
/** EventSource reconnect delay hint (our front-ends reconnect themselves, see liveEvents.js). */
export const LIVE_RETRY_MS = 3_000;
/** At most this many events are replayed; more means the client is better off refetching everything. */
export const LIVE_REPLAY_MAX = 500;

/** One SSE frame. `data` is JSON on a single line. */
export function sseFrame(frame: {
  id?: string;
  event?: string;
  data?: unknown;
  retry?: number;
}): string {
  let out = '';
  if (frame.retry !== undefined) out += `retry: ${frame.retry}\n`;
  if (frame.id) out += `id: ${frame.id}\n`;
  if (frame.event) out += `event: ${frame.event}\n`;
  out += `data: ${JSON.stringify(frame.data ?? {})}\n\n`;
  return out;
}

/** An SSE comment line (ignored by clients): the heartbeat and the ping. */
export const sseComment = (text: string): string => `: ${text}\n\n`;

const STREAM_ID = /^(\d{1,16})-(\d{1,16})$/;

/** A Redis stream id `<ms>-<seq>`, or null when the value is not one. */
export function parseStreamId(
  value: string | undefined | null,
): { ms: number; seq: number } | null {
  const m = STREAM_ID.exec(value?.trim() ?? '');
  return m ? { ms: Number(m[1]), seq: Number(m[2]) } : null;
}

export function compareStreamIds(a: string, b: string): number {
  const x = parseStreamId(a);
  const y = parseStreamId(b);
  if (!x || !y) return 0;
  return x.ms - y.ms || x.seq - y.seq;
}

/**
 * Whether the events after `lastId` can still be replayed: the id is well formed and not older than the buffer.
 * Otherwise the client gets `resync` and refetches everything.
 */
export function replayable(lastId: string, now: number): boolean {
  const id = parseStreamId(lastId);
  return !!id && id.ms >= now - LIVE_BUFFER_MS && id.ms <= now + 60_000;
}
