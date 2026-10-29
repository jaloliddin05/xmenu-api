import { createHmac } from 'crypto';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { TelegramInitDataService } from './telegram-init-data.service';

const VENUE_TOKEN = '111111:venue-token';
const PLATFORM_TOKEN = '222222:platform-token';

/** Signs initData the way Telegram does for a Mini App opened from the bot with `token`. */
function signed(
  token: string,
  user = { id: 555 },
  authDate = Math.floor(Date.now() / 1000),
) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAE',
    user: JSON.stringify(user),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function service(token: string | null) {
  const bots = { initDataToken: jest.fn(async () => token) };
  const cfg = { telegramInitDataMaxAgeSeconds: 86400 } as CustomerAuthConfig;
  return new TelegramInitDataService(cfg, bots as any);
}

describe('TelegramInitDataService.verifyForTenant', () => {
  it('accepts initData signed by the token the venue resolves to', async () => {
    await expect(
      service(VENUE_TOKEN).verifyForTenant('t1', signed(VENUE_TOKEN)),
    ).resolves.toMatchObject({ id: 555 });
  });

  it('rejects initData signed by another bot (platform bot for a venue with its own)', async () => {
    await expect(
      service(VENUE_TOKEN).verifyForTenant('t1', signed(PLATFORM_TOKEN)),
    ).rejects.toMatchObject({ code: 'invalid_telegram_data' });
  });

  it('rejects stale initData', async () => {
    const old = Math.floor(Date.now() / 1000) - 86401;
    await expect(
      service(VENUE_TOKEN).verifyForTenant(
        't1',
        signed(VENUE_TOKEN, { id: 555 }, old),
      ),
    ).rejects.toMatchObject({ code: 'invalid_telegram_data' });
  });
});
