import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { errorMessage } from 'src/infra/helper/error-text';
import {
  LIVE_REPLAY_MAX,
  LiveEnvelope,
  LiveEvent,
  LiveEventType,
  replayable,
} from './live-events';
import { LIVE_TRANSPORT } from './live-transport';
import type { LiveControl, LiveTransport } from './live-transport';

type Listener = (event: LiveEvent) => void;

/** The part of an order an event needs (customer_order row or a select of it). */
export interface LiveOrder {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  customer_id?: string | null;
  status: string;
  version: number;
}

/**
 * Publishes live events after a commit and hands them to the streams of this process. Every event goes through
 * the transport, also on the process that published it, so several API processes see the same order.
 * Publishing never throws: a lost event is logged, the action that caused it has already happened.
 */
@Injectable()
export class LiveEventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Live');
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly controls = new Map<string, Set<() => void>>();
  private readonly invalidators = new Set<(orgId: string) => void>();
  /** Counters for the periodic stats line (LiveStatsService) */
  readonly counters = { events: 0, resyncs: 0, failures: 0 };

  constructor(
    @Inject(LIVE_TRANSPORT) private readonly transport: LiveTransport,
  ) {}

  async onModuleInit() {
    await this.transport.listen({
      event: (orgId, id, payload) => this.deliver(orgId, id, payload),
      control: (channel, message) => this.onControl(channel, message),
    });
  }

  async onModuleDestroy() {
    await this.transport.close();
  }

  async publish(orgId: string, envelope: LiveEnvelope): Promise<void> {
    try {
      await this.transport.append(orgId, JSON.stringify(envelope));
      this.counters.events++;
    } catch (e) {
      this.counters.failures++;
      this.logger.warn(
        `event ${envelope.type} of venue ${orgId} not published: ${errorMessage(e)}`,
      );
    }
  }

  /** A committed change of an order, to the staff of the venue and to the guest who placed it. */
  order(
    order: LiveOrder,
    type: Extract<LiveEventType, `order.${string}`> = 'order.changed',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.publish(order.organization_id, {
      type,
      data: {
        orderId: order.id,
        status: order.status,
        version: order.version,
        branchId: order.branch_id ?? null,
        ...extra,
      },
      to: type === 'order.attention' ? ['staff'] : ['staff', 'guest'],
      branchId: order.branch_id ?? null,
      customerId: order.customer_id ?? null,
    });
  }

  /** Venue data changed (org.changed to the dashboard). */
  orgChanged(
    orgId: string,
    resources: string[],
    origin?: string | null,
  ): Promise<void> {
    return this.publish(orgId, {
      type: 'org.changed',
      data: { resources },
      to: ['staff'],
      origin: origin ?? null,
    });
  }

  /** Listens to the events of a venue on this process; returns the unsubscribe function. */
  subscribe(orgId: string, listener: Listener): () => void {
    let set = this.listeners.get(orgId);
    if (!set) this.listeners.set(orgId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(orgId);
    };
  }

  /** Events after `lastId`, or `resync` when they cannot be replayed (too old, unknown, too many). */
  async replay(
    orgId: string,
    lastId: string,
    now = Date.now(),
  ): Promise<LiveEvent[] | 'resync'> {
    if (!replayable(lastId, now)) return this.resync();
    const rows = await this.transport.since(orgId, lastId);
    if (rows.length > LIVE_REPLAY_MAX) return this.resync();
    const out: LiveEvent[] = [];
    for (const r of rows) {
      const envelope = parseEnvelope(r.payload);
      if (envelope) out.push({ id: r.id, envelope });
    }
    return out;
  }

  latestId(orgId: string): Promise<string | null> {
    return this.transport.latestId(orgId);
  }

  /** The login `sid` was ended (staff or guest): its open streams close on every process. */
  async revoke(kind: 'staff' | 'guest', sid: string): Promise<void> {
    try {
      await this.transport.control('revoke', `${kind}:${sid}`);
    } catch (e) {
      this.logger.warn(
        `revoke of a ${kind} login not published: ${errorMessage(e)}`,
      );
    }
  }

  onRevoke(kind: 'staff' | 'guest', sid: string, cb: () => void): () => void {
    const key = `${kind}:${sid}`;
    let set = this.controls.get(key);
    if (!set) this.controls.set(key, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.controls.delete(key);
    };
  }

  /** In-process caches of a venue are stale on every process (tenant, order settings). */
  async invalidate(orgId: string): Promise<void> {
    try {
      await this.transport.control('invalidate', `tenant:${orgId}`);
    } catch (e) {
      this.logger.warn(`cache invalidation not published: ${errorMessage(e)}`);
    }
  }

  onInvalidate(cb: (orgId: string) => void): () => void {
    this.invalidators.add(cb);
    return () => this.invalidators.delete(cb);
  }

  private resync(): 'resync' {
    this.counters.resyncs++;
    return 'resync';
  }

  private deliver(orgId: string, id: string, payload: string) {
    const set = this.listeners.get(orgId);
    if (!set?.size) return;
    const envelope = parseEnvelope(payload);
    if (!envelope) return;
    for (const l of [...set]) {
      try {
        l({ id, envelope });
      } catch (e) {
        this.logger.warn(`live listener failed: ${errorMessage(e)}`);
      }
    }
  }

  private onControl(channel: LiveControl, message: string) {
    if (channel === 'revoke') {
      for (const cb of [...(this.controls.get(message) ?? [])]) cb();
    } else if (channel === 'invalidate' && message.startsWith('tenant:')) {
      const orgId = message.slice('tenant:'.length);
      for (const cb of this.invalidators) cb(orgId);
    }
  }
}

function parseEnvelope(payload: string): LiveEnvelope | null {
  try {
    const v = JSON.parse(payload) as LiveEnvelope;
    return v && typeof v.type === 'string' && Array.isArray(v.to) ? v : null;
  } catch {
    return null;
  }
}
