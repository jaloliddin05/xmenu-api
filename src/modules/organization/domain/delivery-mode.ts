import type { DeliveryMode } from './publication';

/** What came in X-Telegram-Init-Data: nothing, data signed by the venue bot and fresh, or anything else. */
export type InitDataState = 'absent' | 'valid' | 'invalid';

export type DeliveryModeProblem =
  | 'miniapp_required'
  | 'miniapp_init_data_invalid';

/**
 * Whether a guest may sign in or order through this request under the venue's delivery mode
 * (docs/TELEGRAM_VERIFICATION.md, "Mini App и режимы доставки"):
 * - site: the header is not looked at;
 * - miniapp: valid initData of the venue bot is required;
 * - both: no header is fine, a header that came must be valid.
 */
export function deliveryModeProblem(
  mode: DeliveryMode,
  initData: InitDataState,
): DeliveryModeProblem | null {
  if (mode === 'site') return null;
  if (initData === 'invalid') return 'miniapp_init_data_invalid';
  if (initData === 'absent' && mode === 'miniapp') return 'miniapp_required';
  return null;
}

/** Whether the header has to be verified at all (site ignores it, both ignores its absence). */
export const initDataChecked = (
  mode: DeliveryMode,
  header: string | undefined,
) => mode === 'miniapp' || (mode === 'both' && !!header);
