import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { CustomerAuthException } from '../errors/customer-auth.exception';

export interface RateRule {
  key: string;
  limit: number;
  ttlSeconds: number;
}

// Hammasini atomik tekshiradi; birortasi limitga yetgan bo'lsa HECH NARSA oshirilmaydi.
export const HIT_LUA = `
for i = 1, #KEYS do
  local c = tonumber(redis.call('GET', KEYS[i]) or '0')
  if c >= tonumber(ARGV[i*2-1]) then
    local t = redis.call('TTL', KEYS[i])
    if t < 0 then t = tonumber(ARGV[i*2]) end
    return {i, t}
  end
end
for i = 1, #KEYS do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i*2])) end
end
return {0, 0}
`;

export const ROLLBACK_LUA = `
for i = 1, #KEYS do
  local v = tonumber(redis.call('GET', KEYS[i]) or '0')
  if v > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
`;

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Limit oshib ketsa 429 rate_limited (retryAfter bilan) tashlaydi. */
  async hit(rules: RateRule[]): Promise<void> {
    const args: (string | number)[] = [];
    for (const r of rules) args.push(r.limit, r.ttlSeconds);
    const [idx, ttl] = (await this.redis.eval(
      HIT_LUA,
      rules.length,
      ...rules.map((r) => r.key),
      ...args,
    )) as [number, number];

    if (idx > 0) {
      throw new CustomerAuthException('rate_limited', 'Too many requests', Math.max(1, ttl));
    }
  }

  /** SMS yuborilmay qolsa hisoblagichlarni qaytarish. */
  async rollback(rules: RateRule[]): Promise<void> {
    await this.redis.eval(ROLLBACK_LUA, rules.length, ...rules.map((r) => r.key));
  }
}
