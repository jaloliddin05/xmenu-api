import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { errorMessage } from 'src/infra/helper/error-text';
import { normalizeStreet } from '../domain/street-match';
import { POS_PROVIDER } from '../provider/pos-provider';
import type { PosProvider, PosStreet } from '../provider/pos-provider';
import { PosKeyring } from './pos-keyring';

/** The directory is asked again once a day (audit W15-19) */
export const STREETS_TTL_SECONDS = 24 * 3600;
/** Streets answered to one operator query */
export const STREETS_LIMIT = 20;

const cacheKey = (integrationId: string, orgId: string) =>
  `pos:geo:${integrationId}:${orgId}`;

interface Integration {
  id: string;
  api_key_encrypted: string | null;
  external_org_id: string | null;
}

/**
 * Cities and streets of the iiko organization, kept in Redis for a day: the operator's search and the
 * street matching read them instead of walking every city of iiko on each keystroke.
 */
@Injectable()
export class PosStreetsCache {
  private readonly logger = new Logger('PosStreets');

  constructor(
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly keyring: PosKeyring,
  ) {}

  async streets(integration: Integration): Promise<PosStreet[]> {
    const orgId = integration.external_org_id;
    if (!orgId) return [];
    const key = cacheKey(integration.id, orgId);
    const cached = await this.redis.get(key).catch((e: unknown) => {
      this.logger.warn(`street cache not read: ${errorMessage(e)}`);
      return null;
    });
    if (cached) return JSON.parse(cached) as PosStreet[];
    const list = await this.provider.streets(
      this.keyring.credentials(integration),
      orgId,
    );
    await this.redis
      .set(key, JSON.stringify(list), 'EX', STREETS_TTL_SECONDS)
      .catch((e: unknown) =>
        this.logger.warn(`street cache not written: ${errorMessage(e)}`),
      );
    return list;
  }

  /** Streets whose name contains the query (case, ё and apostrophes ignored). */
  async search(integration: Integration, query: string): Promise<PosStreet[]> {
    const q = normalizeStreet(query);
    const out: PosStreet[] = [];
    for (const s of await this.streets(integration)) {
      if (q && !normalizeStreet(s.name).includes(q)) continue;
      out.push(s);
      if (out.length >= STREETS_LIMIT) break;
    }
    return out;
  }
}
