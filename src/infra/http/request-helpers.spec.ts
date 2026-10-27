import { pickTranslation, resolveLang } from './request-helpers';

describe('resolveLang', () => {
  it('?lang wins over the header', () => {
    expect(resolveLang({ query: { lang: 'uz' }, headers: { 'accept-language': 'en' } })).toBe('uz');
  });
  it('parses Accept-Language with regions and weights', () => {
    expect(resolveLang({ headers: { 'accept-language': 'uz-UZ,ru;q=0.8,en;q=0.5' } })).toBe('uz');
    expect(resolveLang({ headers: { 'accept-language': 'de,en-US;q=0.9' } })).toBe('en');
  });
  it('defaults to ru', () => {
    expect(resolveLang({})).toBe('ru');
    expect(resolveLang({ query: { lang: 'zz' }, headers: { 'accept-language': 'fr' } })).toBe('ru');
  });
});

describe('pickTranslation', () => {
  const list = [{ lang: 'en', t: 'E' }, { lang: 'uz', t: 'U' }];
  it('prefers the requested language, then ru/uz/en, then anything', () => {
    expect(pickTranslation(list, 'en')?.t).toBe('E');
    expect(pickTranslation(list, 'ru')?.t).toBe('U'); // no ru → uz
    expect(pickTranslation([{ lang: 'de', t: 'D' }], 'ru')?.t).toBe('D');
    expect(pickTranslation([], 'ru')).toBeUndefined();
  });
});
