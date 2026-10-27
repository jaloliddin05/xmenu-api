import { BUMP_LUA } from 'src/modules/auth/services/customer-otp.service';
import { HIT_LUA, ROLLBACK_LUA } from 'src/modules/auth/services/rate-limit.service';

type Value = string | Map<string, string>;

interface Entry {
  value: Value;
  expiresAt?: number; // ms on the fake clock
}

/**
 * In-memory Redis for unit tests. Implements only the commands the auth code uses, plus the
 * known Lua scripts (matched by their exact text, re-implemented in JS). Time only moves
 * through `advance()`, so TTL behaviour is deterministic.
 */
export class FakeRedis {
  private data = new Map<string, Entry>();
  private clock = 0;

  advance(seconds: number) {
    this.clock += seconds * 1000;
  }

  keys(): string[] {
    return [...this.data.keys()].filter((k) => this.live(k));
  }

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && e.expiresAt <= this.clock) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private str(key: string): string | null {
    const e = this.live(key);
    if (!e) return null;
    if (typeof e.value !== 'string') throw new Error(`WRONGTYPE ${key}`);
    return e.value;
  }

  private hash(key: string, create: boolean): Map<string, string> | null {
    const e = this.live(key);
    if (!e) {
      if (!create) return null;
      const m = new Map<string, string>();
      this.data.set(key, { value: m });
      return m;
    }
    if (typeof e.value === 'string') throw new Error(`WRONGTYPE ${key}`);
    return e.value;
  }

  async get(key: string) {
    return this.str(key);
  }

  async set(key: string, value: string | number, ...opts: (string | number)[]) {
    let ex: number | undefined;
    let nx = false;
    for (let i = 0; i < opts.length; i++) {
      const o = String(opts[i]).toUpperCase();
      if (o === 'EX') ex = Number(opts[++i]);
      else if (o === 'NX') nx = true;
      else throw new Error(`FakeRedis.set: unsupported option ${o}`);
    }
    if (nx && this.live(key)) return null;
    this.data.set(key, {
      value: String(value),
      expiresAt: ex !== undefined ? this.clock + ex * 1000 : undefined,
    });
    return 'OK';
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      if (this.live(k)) {
        this.data.delete(k);
        n++;
      }
    }
    return n;
  }

  async exists(key: string) {
    return this.live(key) ? 1 : 0;
  }

  private incrBy(key: string, by: number) {
    const e = this.live(key);
    const next = Number(e ? this.str(key) : 0) + by;
    this.data.set(key, { value: String(next), expiresAt: e?.expiresAt });
    return next;
  }

  async incr(key: string) {
    return this.incrBy(key, 1);
  }

  async decr(key: string) {
    return this.incrBy(key, -1);
  }

  async expire(key: string, seconds: number) {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = this.clock + seconds * 1000;
    return 1;
  }

  async ttl(key: string) {
    const e = this.live(key);
    if (!e) return -2;
    if (e.expiresAt === undefined) return -1;
    return Math.ceil((e.expiresAt - this.clock) / 1000);
  }

  async hset(key: string, ...fieldValues: (string | number)[]) {
    const h = this.hash(key, true)!;
    let added = 0;
    for (let i = 0; i < fieldValues.length; i += 2) {
      if (!h.has(String(fieldValues[i]))) added++;
      h.set(String(fieldValues[i]), String(fieldValues[i + 1]));
    }
    return added;
  }

  async hget(key: string, field: string) {
    return this.hash(key, false)?.get(field) ?? null;
  }

  async hincrby(key: string, field: string, by: number) {
    const h = this.hash(key, true)!;
    const next = Number(h.get(field) ?? 0) + by;
    h.set(field, String(next));
    return next;
  }

  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === 'exec') {
            return async () => {
              const out: [null, unknown][] = [];
              for (const op of ops) out.push([null, await op()]);
              return out;
            };
          }
          const fn = (this as any)[name];
          if (typeof fn !== 'function') throw new Error(`FakeRedis.multi: unsupported ${name}`);
          return (...args: unknown[]) => {
            ops.push(() => fn.apply(this, args));
            return chain;
          };
        },
      },
    );
    return chain as any;
  }

  async eval(script: string, numKeys: number, ...rest: (string | number)[]) {
    const keys = rest.slice(0, numKeys).map(String);
    const args = rest.slice(numKeys);

    if (script === HIT_LUA) {
      for (let i = 0; i < keys.length; i++) {
        const c = Number(this.str(keys[i]) ?? 0);
        if (c >= Number(args[i * 2])) {
          let t = await this.ttl(keys[i]);
          if (t < 0) t = Number(args[i * 2 + 1]);
          return [i + 1, t];
        }
      }
      for (let i = 0; i < keys.length; i++) {
        const n = await this.incr(keys[i]);
        if (n === 1) await this.expire(keys[i], Number(args[i * 2 + 1]));
      }
      return [0, 0];
    }

    if (script === ROLLBACK_LUA) {
      for (const k of keys) {
        if (Number(this.str(k) ?? 0) > 0) await this.decr(k);
      }
      return 1;
    }

    if (script === BUMP_LUA) {
      const h = await this.hget(keys[0], 'h');
      if (!h) return null;
      const a = await this.hincrby(keys[0], 'attempts', 1);
      return [h, a];
    }

    throw new Error('FakeRedis.eval: unknown script');
  }
}
