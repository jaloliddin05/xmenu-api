import { createHmac } from 'crypto';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { MiniAppAccessService } from './mini-app-access.service';
import { TelegramInitDataService } from './telegram-init-data.service';

export const VENUE_BOT_TOKEN = '111111:venue-token';
export const OTHER_BOT_TOKEN = '333333:other-token';
export const INIT_DATA_MAX_AGE = 86400;

/** Signs initData the way Telegram does for a Mini App opened from the bot with `token`. */
export function signInitData(
  token: string,
  user: { id: number } = { id: 555 },
  authDate = Math.floor(Date.now() / 1000),
): string {
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

/** The header cases every mode is tested with; `null` means no header. */
export const INIT_DATA_CASES = {
  absent: () => undefined,
  forged: () =>
    signInitData(VENUE_BOT_TOKEN).replace(/hash=[0-9a-f]{4}/, 'hash=0000'),
  expired: () =>
    signInitData(
      VENUE_BOT_TOKEN,
      { id: 555 },
      Math.floor(Date.now() / 1000) - INIT_DATA_MAX_AGE - 1,
    ),
  foreignBot: () => signInitData(OTHER_BOT_TOKEN),
  valid: () => signInitData(VENUE_BOT_TOKEN),
} as const;
export type InitDataCase = keyof typeof INIT_DATA_CASES;

/**
 * MiniAppAccessService with the real initData check; the venue's bot (`hasBot`) and delivery mode
 * come from the test.
 */
export function miniAppAccess(state: {
  mode: () => 'site' | 'miniapp' | 'both';
  hasBot: () => boolean;
}) {
  const bots = {
    forTenant: jest.fn(async () =>
      state.hasBot() ? { token: VENUE_BOT_TOKEN, botKey: 'bot-1' } : null,
    ),
  };
  const prisma = {
    organization: {
      findUnique: jest.fn(async () => ({ delivery_mode: state.mode() })),
    },
  };
  const cfg = {
    telegramInitDataMaxAgeSeconds: INIT_DATA_MAX_AGE,
  } as CustomerAuthConfig;
  return new MiniAppAccessService(
    prisma as any,
    bots as any,
    new TelegramInitDataService(cfg, bots as any),
  );
}
