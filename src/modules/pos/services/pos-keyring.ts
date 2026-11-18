import { Injectable } from '@nestjs/common';
import {
  decryptConfig,
  encryptConfig,
  parsePaymentConfigKey,
} from 'src/modules/payment/domain/payment-crypto';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import type { PosCredentials } from '../provider/pos-provider';

/**
 * The restaurant's POS key at rest: AES-256-GCM with PAYMENT_CONFIG_KEY, the same scheme as payment
 * keys and bot tokens. A key that cannot be decrypted (PAYMENT_CONFIG_KEY changed or lost) is
 * platform_misconfigured (pos), and the owner enters the key again.
 */
@Injectable()
export class PosKeyring {
  private cachedKey?: Buffer;

  private get key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    try {
      return (this.cachedKey = parsePaymentConfigKey(
        process.env.PAYMENT_CONFIG_KEY,
      ));
    } catch {
      throw platformMisconfigured(
        'pos',
        'PAYMENT_CONFIG_KEY is not a 32-byte key: POS keys cannot be stored',
      );
    }
  }

  encrypt(apiKey: string): string {
    return encryptConfig({ apiKey }, this.key);
  }

  credentials(row: {
    id: string;
    api_key_encrypted: string | null;
  }): PosCredentials {
    // A disconnected integration has no key
    if (!row.api_key_encrypted) throw new AppException('pos_not_connected');
    const key = this.key;
    try {
      const { apiKey } = decryptConfig<{ apiKey: string }>(
        row.api_key_encrypted,
        key,
      );
      if (typeof apiKey !== 'string' || !apiKey) throw new Error('no key');
      return { integrationId: row.id, apiKey };
    } catch {
      throw platformMisconfigured(
        'pos',
        `POS key of integration ${row.id} cannot be decrypted: PAYMENT_CONFIG_KEY changed or the stored key is corrupted; the owner has to enter the key again`,
      );
    }
  }
}
