import { FakeRedis } from 'src/infra/redis/redis.fake';
import { PosStreetsCache, STREETS_TTL_SECONDS } from './pos-streets.cache';

describe('PosStreetsCache', () => {
  const integration = {
    id: 'int-1',
    api_key_encrypted: 'enc',
    external_org_id: 'o1',
  };
  let provider: { streets: jest.Mock };
  let redis: FakeRedis;
  let cache: PosStreetsCache;

  beforeEach(() => {
    provider = {
      streets: jest.fn(async () => [
        { id: 's1', name: 'улица Навои', city: 'Ташкент' },
        { id: 's2', name: "Navoiy ko'chasi", city: 'Toshkent' },
        { id: 's3', name: 'Бобура', city: 'Ташкент' },
      ]),
    };
    redis = new FakeRedis();
    cache = new PosStreetsCache(
      provider as any,
      redis as any,
      { credentials: () => ({ integrationId: 'int-1', apiKey: 'k' }) } as any,
    );
  });

  it('asks iiko once a day; the operator search reads the cache', async () => {
    expect(await cache.search(integration, 'Нав')).toEqual([
      { id: 's1', name: 'улица Навои', city: 'Ташкент' },
    ]);
    expect(
      (await cache.search(integration, 'navoiy')).map((s) => s.id),
    ).toEqual(['s2']);
    expect(provider.streets).toHaveBeenCalledTimes(1);
    redis.advance(STREETS_TTL_SECONDS + 1);
    await cache.search(integration, '');
    expect(provider.streets).toHaveBeenCalledTimes(2);
  });

  it('kept per organization of the integration', async () => {
    await cache.streets(integration);
    await cache.streets({ ...integration, external_org_id: 'o2' });
    expect(provider.streets).toHaveBeenCalledTimes(2);
  });
});
