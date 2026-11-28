import {
  LIVE_BUFFER_MS,
  LIVE_REPLAY_MAX,
  compareStreamIds,
} from './live-events';
import type {
  LiveControl,
  LiveTransport,
  LiveTransportHandlers,
} from './live-transport';

/**
 * In-memory transport with the semantics of RedisLiveTransport: ids `<ms>-<seq>` from an injected clock, a log
 * trimmed to the buffer, delivery to every listener (several "processes" can listen to one fake).
 */
export class FakeLiveTransport implements LiveTransport {
  private logs = new Map<string, { id: string; payload: string }[]>();
  private listeners: LiveTransportHandlers[] = [];
  private lastMs = 0;
  private seq = 0;
  readonly controls: { channel: LiveControl; message: string }[] = [];

  constructor(public now: () => number = Date.now) {}

  append(orgId: string, payload: string): Promise<string> {
    const ms = this.now();
    this.seq = ms === this.lastMs ? this.seq + 1 : 0;
    this.lastMs = ms;
    const id = `${ms}-${this.seq}`;
    const log = (this.logs.get(orgId) ?? []).filter(
      (e) => Number(e.id.split('-')[0]) >= ms - LIVE_BUFFER_MS,
    );
    log.push({ id, payload });
    this.logs.set(orgId, log);
    for (const l of this.listeners) l.event(orgId, id, payload);
    return Promise.resolve(id);
  }

  since(orgId: string, afterId: string) {
    return Promise.resolve(
      (this.logs.get(orgId) ?? [])
        .filter((e) => compareStreamIds(e.id, afterId) > 0)
        .slice(0, LIVE_REPLAY_MAX + 1),
    );
  }

  latestId(orgId: string) {
    const log = this.logs.get(orgId) ?? [];
    return Promise.resolve(log[log.length - 1]?.id ?? null);
  }

  control(channel: LiveControl, message: string) {
    this.controls.push({ channel, message });
    for (const l of this.listeners) l.control(channel, message);
    return Promise.resolve();
  }

  listen(handlers: LiveTransportHandlers) {
    this.listeners.push(handlers);
    return Promise.resolve();
  }

  close() {
    this.listeners = [];
    return Promise.resolve();
  }

  /** Every stored envelope of a venue, parsed (for assertions). */
  envelopes(orgId: string): unknown[] {
    return (this.logs.get(orgId) ?? []).map((e) => JSON.parse(e.payload));
  }
}
