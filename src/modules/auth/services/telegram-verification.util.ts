export type BotLang = 'ru' | 'uz' | 'en';

/** Telegram `language_code` (ISO 639-1, sometimes with a region) -> bot message language. */
export function pickBotLang(code: string | undefined): BotLang {
  const c = (code ?? '').toLowerCase().slice(0, 2);
  return c === 'uz' || c === 'en' ? c : 'ru';
}

/** Telegram sends the contact phone without '+' (e.g. 998901234567). */
export function normalizeTelegramPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

/** Brand names are tenant-controlled and the bot uses parse_mode=HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
