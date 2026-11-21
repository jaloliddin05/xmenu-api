import Redis from 'ioredis';
import { bullConnection } from './bull-connection';

// Production Redis requires a password (infra/env/redis.env); the queues must not drop it from REDIS_URL
describe('bullConnection', () => {
  it('keeps the password of REDIS_URL', () => {
    const pw = 'a'.repeat(64);
    expect(bullConnection({ REDIS_URL: `redis://:${pw}@redis:6379` })).toEqual({
      host: 'redis',
      port: 6379,
      username: undefined,
      password: pw,
      db: undefined,
      tls: undefined,
    });
  });

  it('decodes a percent-encoded user and password', () => {
    const conn = bullConnection({
      REDIS_URL: 'redis://queue%40x:p%40ss%3Aw%2Fd@redis:6380/2',
    });
    expect(conn).toMatchObject({
      host: 'redis',
      port: 6380,
      username: 'queue@x',
      password: 'p@ss:w/d',
      db: 2,
    });
  });

  it('turns rediss into TLS and defaults the port', () => {
    expect(
      bullConnection({ REDIS_URL: 'rediss://:pw@cache.example' }),
    ).toMatchObject({
      host: 'cache.example',
      port: 6379,
      password: 'pw',
      tls: {},
    });
  });

  it('has no password when the URL has none', () => {
    expect(
      bullConnection({ REDIS_URL: 'redis://localhost:6379' }).password,
    ).toBeUndefined();
  });

  it('falls back to REDIS_HOST, REDIS_PORT and REDIS_PASSWORD without REDIS_URL', () => {
    expect(
      bullConnection({
        REDIS_HOST: 'redis',
        REDIS_PORT: '6390',
        REDIS_PASSWORD: 'pw',
      }),
    ).toEqual({ host: 'redis', port: 6390, password: 'pw' });
  });

  it('agrees with ioredis on the same URL (RedisModule passes REDIS_URL to it as is)', async () => {
    const url = 'redis://:p%40ss@redis:6379/1';
    const client = new Redis(url, { lazyConnect: true });
    try {
      const conn = bullConnection({ REDIS_URL: url });
      expect(client.options).toMatchObject({
        host: conn.host,
        port: conn.port,
        password: conn.password,
        db: conn.db,
      });
    } finally {
      client.disconnect();
    }
  });
});
