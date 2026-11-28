import type { Redis } from 'ioredis';
import { LIVE_BUFFER_MS, LIVE_REPLAY_MAX } from './live-events';

export const LIVE_TRANSPORT = 'LIVE_TRANSPORT';

/** Control channels shared by every API process. */
export type LiveControl =
  /** `staff:<sid>` or `guest:<sid>`: the login was ended, its streams close now */
  | 'revoke'
  /** `tenant:<orgId>`: in-process caches of the venue are dropped (tenant, order settings) */
  | 'invalidate';

export interface LiveTransportHandlers {
  event(orgId: string, id: string, payload: string): void;
  control(channel: LiveControl, message: string): void;
}

/**
 * Where live events go: a short log per venue (replay after a reconnect) and a fan-out to every API process.
 * Redis in production (RedisLiveTransport), in memory in specs (live-transport.fake.ts).
 */
export interface LiveTransport {
  /** Appends to the venue log and fans out; returns the event id */
  append(orgId: string, payload: string): Promise<string>;
  /** Events after `afterId`, oldest first, at most LIVE_REPLAY_MAX + 1 */
  since(
    orgId: string,
    afterId: string,
  ): Promise<{ id: string; payload: string }[]>;
  /** The id of the newest event of the venue, null when the log is empty */
  latestId(orgId: string): Promise<string | null>;
  control(channel: LiveControl, message: string): Promise<void>;
  /** Starts receiving the fan-out (once per process) */
  listen(handlers: LiveTransportHandlers): Promise<void>;
  close(): Promise<void>;
}

const logKey = (orgId: string) => `live:log:${orgId}`;
const ORG_CHANNEL = 'live:org:';
const CONTROL_CHANNEL = 'live:ctl:';

/**
 * XADD with trimming by age, an expiry for venues that went quiet, and the fan-out message, in one step so a
 * listener never sees an event that the log does not have.
 */
const APPEND_LUA = `
local id = redis.call('XADD', KEYS[1], 'MINID', '~', ARGV[1], '*', 'p', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PUBLISH', ARGV[4], id .. ' ' .. ARGV[2])
return id
`;

export class RedisLiveTransport implements LiveTransport {
  private subscriber?: Redis;

  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  async append(orgId: string, payload: string): Promise<string> {
    const minId = String(this.now() - LIVE_BUFFER_MS);
    return (await this.redis.eval(
      APPEND_LUA,
      1,
      logKey(orgId),
      minId,
      payload,
      String(LIVE_BUFFER_MS * 2),
      ORG_CHANNEL + orgId,
    )) as string;
  }

  async since(orgId: string, afterId: string) {
    const rows = await this.redis.xrange(
      logKey(orgId),
      `(${afterId}`,
      '+',
      'COUNT',
      LIVE_REPLAY_MAX + 1,
    );
    return rows.map(([id, fields]) => ({ id, payload: fields[1] ?? '{}' }));
  }

  async latestId(orgId: string): Promise<string | null> {
    const rows = await this.redis.xrevrange(
      logKey(orgId),
      '+',
      '-',
      'COUNT',
      1,
    );
    return rows[0]?.[0] ?? null;
  }

  async control(channel: LiveControl, message: string): Promise<void> {
    await this.redis.publish(CONTROL_CHANNEL + channel, message);
  }

  async listen(handlers: LiveTransportHandlers): Promise<void> {
    // A subscribed connection cannot run other commands: a dedicated one per process
    const sub = (this.subscriber = this.redis.duplicate());
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      if (channel.startsWith(ORG_CHANNEL)) {
        const space = message.indexOf(' ');
        if (space > 0)
          handlers.event(
            channel.slice(ORG_CHANNEL.length),
            message.slice(0, space),
            message.slice(space + 1),
          );
      } else if (channel.startsWith(CONTROL_CHANNEL))
        handlers.control(
          channel.slice(CONTROL_CHANNEL.length) as LiveControl,
          message,
        );
    });
    await sub.psubscribe(`${ORG_CHANNEL}*`, `${CONTROL_CHANNEL}*`);
  }

  async close(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
