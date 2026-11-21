import type { StepUpAction } from './step-up.decorator';
import {
  SMS_BRAND_FALLBACK,
  smsBrand,
} from 'src/modules/auth/services/sms-brand';

/** Venue name as it goes into the SMS: the same cleaning as every SMS (smsBrand); a name it refuses is left out. */
export function smsVenueName(name: string | null | undefined): string {
  const brand = smsBrand(name);
  return brand === SMS_BRAND_FALLBACK ? '' : brand;
}

const PROVIDER_NAMES: Record<string, string> = {
  click: 'Click',
  payme: 'Payme',
};

/** What changed, in the words of the SMS (no values, no technical details). */
function changeText(action: StepUpAction, provider?: string): string {
  switch (action) {
    case 'payment_keys_changed': {
      const name = provider ? PROVIDER_NAMES[provider] : undefined;
      return name ? `платёжные ключи ${name}` : 'платёжные ключи';
    }
    case 'telegram_bot_changed':
      return 'Telegram-бот подключён или заменён';
    case 'telegram_bot_removed':
      return 'Telegram-бот отключён';
    case 'iiko_key_changed':
      return 'ключ iiko';
    case 'iiko_disconnected':
      return 'iiko отключена';
    case 'organization_deleted':
    case 'account_deleted':
      return '';
  }
}

/** SMS to the owner after a critical action. */
export function ownerSecuritySms(
  action: StepUpAction,
  venueName: string,
  provider?: string,
): string {
  const venue = venueName ? ` «${venueName}»` : '';
  if (action === 'organization_deleted')
    return `В Xmenu удалено заведение${venue}. Если это были не вы, срочно смените пароль и напишите в поддержку Xmenu.`;
  if (action === 'account_deleted')
    return `В Xmenu удалён аккаунт владельца заведения${venue}. Если это были не вы, напишите в поддержку Xmenu.`;
  return `В Xmenu изменены настройки (${changeText(action, provider)}) заведения${venue}. Если это были не вы, смените пароль.`;
}
