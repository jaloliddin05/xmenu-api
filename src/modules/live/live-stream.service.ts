import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import { LiveEventBus } from './live-event-bus';
import {
  CloseReason,
  LIVE_HEARTBEAT_MS,
  LIVE_RETRY_MS,
  LiveAudience,
  LiveEnvelope,
  LiveEvent,
  compareStreamIds,
  sseComment,
  sseFrame,
} from './live-events';

/** Open streams per key on one process (the limits are per process, docs/API.md, "События (SSE)"). */
export const LIVE_LIMITS = {
  /** staff user, all tabs and devices */
  user: 5,
  /** guest of a venue */
  guest: 3,
  /** any stream from one IP (a venue with several tablets behind one address included) */
  ip: 50,
} as const;

/** setTimeout cannot wait longer than this; a longer token is closed at this point and reconnects. */
const MAX_TIMER_MS = 2_147_483_647;

export interface StreamOptions {
  audience: LiveAudience;
  orgId: string;
  /** Extra filter on top of the audience (branch, own orders) */
  accept?: (envelope: LiveEnvelope) => boolean;
  /** What goes out as `data` (the default: the event data as published) */
  view?: (envelope: LiveEnvelope) => Record<string, unknown>;
  lastEventId?: string;
  /** When the access token expires (ms since epoch): the stream ends with `bye token_expired` */
  expiresAt?: number;
  /** The login whose end closes the stream with `bye revoked` */
  revoke?: { kind: 'staff' | 'guest'; sid: string };
  /** Keys of LIVE_LIMITS this stream counts against, e.g. { user: id, ip } */
  limits: Partial<Record<keyof typeof LIVE_LIMITS, string>>;
}

/**
 * Serves one SSE stream: headers, `ready` with the newest id, the events missed since Last-Event-ID (or `resync`),
 * then live events of the venue, a heartbeat comment, and a `bye` when the token expires or the login is ended.
 * The stream holds no transaction and no database connection; after opening it reads nothing.
 */
@Injectable()
export class LiveStreamService {
  private readonly logger = new Logger('LiveStream');
  private readonly open = new Map<string, number>();
  /** Open streams by audience (the stats line) */
  readonly gauges: Record<LiveAudience, number> = {
    staff: 0,
    guest: 0,
    public: 0,
    verification: 0,
  };

  constructor(private readonly bus: LiveEventBus) {}

  async serve(req: Request, res: Response, o: StreamOptions): Promise<void> {
    const keys = Object.entries(o.limits)
      .filter(([, v]) => v)
      .map(([k, v]) => ({
        key: `${k}:${v}`,
        max: LIVE_LIMITS[k as keyof typeof LIVE_LIMITS],
      }));
    if (keys.some(({ key, max }) => (this.open.get(key) ?? 0) >= max))
      throw new AppException('rate_limited', {
        message: 'Too many open event streams.',
        retryAfter: 30,
      });
    for (const { key } of keys)
      this.open.set(key, (this.open.get(key) ?? 0) + 1);
    this.gauges[o.audience]++;

    const accept = (e: LiveEnvelope) =>
      e.to.includes(o.audience) && (o.accept?.(e) ?? true);
    const view = o.view ?? ((e: LiveEnvelope) => e.data);

    // Events arriving while the missed ones are read wait here, so the order holds and nothing is lost
    let replaying = true;
    const pending: LiveEvent[] = [];
    let lastSent = o.lastEventId ?? '';
    let closed = false;
    const cleanups: (() => void)[] = [];

    const write = (chunk: string) => {
      if (!closed) res.write(chunk);
    };
    const send = (event: LiveEvent) => {
      if (!accept(event.envelope)) return;
      if (lastSent && compareStreamIds(event.id, lastSent) <= 0) return;
      lastSent = event.id;
      write(
        sseFrame({
          id: event.id,
          event: event.envelope.type,
          data: view(event.envelope),
        }),
      );
    };
    const close = (reason?: CloseReason) => {
      if (closed) return;
      if (reason) write(sseFrame({ event: 'bye', data: { reason } }));
      closed = true;
      for (const c of cleanups) c();
      res.end();
    };

    cleanups.push(
      this.bus.subscribe(o.orgId, (event) => {
        if (replaying) pending.push(event);
        else send(event);
      }),
    );
    if (o.revoke)
      cleanups.push(
        this.bus.onRevoke(o.revoke.kind, o.revoke.sid, () => close('revoked')),
      );
    const beat = setInterval(() => write(sseComment('hb')), LIVE_HEARTBEAT_MS);
    cleanups.push(() => clearInterval(beat));
    if (o.expiresAt) {
      const timer = setTimeout(
        () => close('token_expired'),
        Math.min(Math.max(o.expiresAt - Date.now(), 0), MAX_TIMER_MS),
      );
      cleanups.push(() => clearTimeout(timer));
    }
    cleanups.push(() => {
      for (const { key } of keys) {
        const n = (this.open.get(key) ?? 1) - 1;
        if (n > 0) this.open.set(key, n);
        else this.open.delete(key);
      }
      this.gauges[o.audience]--;
    });
    req.on('close', () => close());

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    // nginx-style proxies: do not buffer (Caddy is configured for /events/* in infra/caddy/Caddyfile)
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    write(`retry: ${LIVE_RETRY_MS}\n\n`);

    try {
      // The newest id first, then the replay: anything appended in between is in the replay, nothing falls
      // between the two reads
      const latest = (await this.bus.latestId(o.orgId)) ?? `${Date.now()}-0`;
      let replayed: LiveEvent[] = [];
      let resync = false;
      if (o.lastEventId) {
        const r = await this.bus.replay(o.orgId, o.lastEventId);
        if (r === 'resync') resync = true;
        else replayed = r;
      }
      if (resync) lastSent = '';
      for (const e of replayed) send(e);
      // `ready`: the client refetches what is on screen (the state now); after `resync` that is required
      const readyId =
        lastSent && compareStreamIds(lastSent, latest) > 0 ? lastSent : latest;
      write(
        sseFrame({ id: readyId, event: resync ? 'resync' : 'ready', data: {} }),
      );
      lastSent = readyId;
      replaying = false;
      for (const e of pending.splice(0)) send(e);
    } catch (e) {
      this.logger.warn(
        `stream of venue ${o.orgId} failed to open: ${errorMessage(e)}`,
      );
      close();
    }
  }
}
