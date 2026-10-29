import {
  escapeHtml,
  normalizeTelegramPhone,
  pickBotLang,
} from './telegram-verification.util';
import { BOT_MESSAGES } from './telegram-verification.messages';

describe('telegram verification utils', () => {
  it('normalizes the phone Telegram sends without a plus', () => {
    expect(normalizeTelegramPhone('998901234567')).toBe('+998901234567');
    expect(normalizeTelegramPhone('+998 90 123-45-67')).toBe('+998901234567');
    expect(normalizeTelegramPhone('')).toBeNull();
    expect(normalizeTelegramPhone(undefined)).toBeNull();
    expect(normalizeTelegramPhone(998901234567)).toBeNull();
  });

  it('picks the bot language from Telegram language_code, Russian by default', () => {
    expect(pickBotLang('uz')).toBe('uz');
    expect(pickBotLang('en-US')).toBe('en');
    expect(pickBotLang('ru')).toBe('ru');
    expect(pickBotLang('de')).toBe('ru');
    expect(pickBotLang(undefined)).toBe('ru');
  });

  it('escapes tenant-controlled brand names in bot messages', () => {
    expect(escapeHtml('A&B <b>x</b>')).toBe('A&amp;B &lt;b&gt;x&lt;/b&gt;');
    const text = BOT_MESSAGES.ru.code('<script>', '123456');
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
    expect(text).toContain('<b>123456</b>');
  });
});
