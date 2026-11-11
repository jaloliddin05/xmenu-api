import { BOT_MESSAGES } from './telegram-verification.messages';

describe('BOT_MESSAGES', () => {
  const ru = BOT_MESSAGES.ru;

  it('has the same keys in ru, uz and en', () => {
    for (const lang of ['uz', 'en'] as const)
      expect(Object.keys(BOT_MESSAGES[lang]).sort()).toEqual(
        Object.keys(ru).sort(),
      );
  });

  it('keeps the code and the brand in every language', () => {
    for (const lang of ['ru', 'uz', 'en'] as const) {
      const t = BOT_MESSAGES[lang];
      expect(t.code('Mant', '123456')).toContain('123456');
      expect(t.code('Mant', '123456')).toContain('Mant');
      expect(t.askContact('Mant')).toContain('Mant');
    }
  });

  it('writes uz and en without Cyrillic (Uzbek is Latin script)', () => {
    for (const lang of ['uz', 'en'] as const) {
      const t = BOT_MESSAGES[lang];
      const all = Object.values(t).map((v) =>
        typeof v === 'function' ? v('Mant', '123456') : v,
      );
      for (const text of all) expect(text).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});
