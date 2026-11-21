import { SMS_BRAND_FALLBACK, smsBrand } from './sms-brand';

describe('smsBrand', () => {
  it.each([
    ['Mant', 'Mant'],
    ['  Mant   Cafe ', 'Mant Cafe'],
    ['Кафе «Самса»', 'Кафе Самса'],
    ["Choyxona O'rik", "Choyxona O'rik"],
    ['Oʻzbegim Gʻijduvon', 'Oʻzbegim Gʻijduvon'],
    ['Ўзбекистон Қаҳвахонаси', 'Ўзбекистон Қаҳвахонаси'],
    ['Burger-House 24', 'Burger-House 24'],
    ['Pizza & Co!', 'Pizza Co'],
    ['Café № 1 🍕', 'Café 1'],
    ['Шашлык: «Номер 1»', 'Шашлык Номер 1'],
  ])('%p → %p', (name, expected) => {
    expect(smsBrand(name)).toBe(expected);
  });

  it('cuts to 30 characters', () => {
    const out = smsBrand('Очень длинное название заведения на набережной');
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toBe('Очень длинное название заведен');
  });

  it.each([
    ['empty', ''],
    ['only symbols', '!!! *** ???'],
    ['emoji only', '🍕🍔'],
    ['null', null],
    ['url', 'https://evil.example/pay'],
    ['www', 'www pay me now www.x'],
    ['domain', 'Pay at payme-help.uz now'],
    ['domain in Cyrillic', 'зайди на сайт.рф'],
    ['phone', 'Payme: карта заблокирована, звоните +998 90 123 45 67'],
    ['phone with brackets', 'Call (90) 123-4567'],
    ['seven digits', 'Code 1234567'],
  ])('%s → fallback', (_what, name) => {
    expect(smsBrand(name)).toBe(SMS_BRAND_FALLBACK);
  });

  it('six digits in a row are allowed', () => {
    expect(smsBrand('Kafe 123456')).toBe('Kafe 123456');
  });
});
