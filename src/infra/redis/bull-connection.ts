import type { RedisOptions } from 'ioredis';

/**
 * BullMQ ulanishi. REDIS_URL (redis:// yoki rediss://) bo'lsa o'sha, aks holda
 * REDIS_HOST/PORT/PASSWORD — RedisModule bilan bir xil manbalar. Avval
 * bull.config.ts faqat host/port o'qirdi: parolli Redis'da navbatlar ishlamas edi.
 */
export function bullConnection(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  if (env.REDIS_URL) {
    const u = new URL(env.REDIS_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
      tls: u.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return {
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT || 6379),
    password: env.REDIS_PASSWORD || undefined,
  };
}
