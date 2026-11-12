import {
  acceptedLanguages,
  isLang,
  pickTranslation,
  resolveLang,
} from './request-helpers';

describe('resolveLang', () => {
  const all = {
    languages: ['ru', 'uz', 'en'] as const,
    defaultLanguage: 'ru' as const,
  };
  const uzOnly = { languages: ['uz'] as const, defaultLanguage: 'uz' as const };

  it('?lang wins over the header', () => {
    expect(
      resolveLang(
        { query: { lang: 'uz' }, headers: { 'accept-language': 'en' } },
        all,
      ),
    ).toBe('uz');
  });
  it('parses Accept-Language with regions and weights', () => {
    expect(
      resolveLang(
        { headers: { 'accept-language': 'uz-UZ,ru;q=0.8,en;q=0.5' } },
        all,
      ),
    ).toBe('uz');
    expect(
      resolveLang({ headers: { 'accept-language': 'de,en-US;q=0.9' } }, all),
    ).toBe('en');
  });
  it('honours q-weights, not the order in the header', () => {
    expect(
      resolveLang(
        { headers: { 'accept-language': 'ru;q=0.1, en;q=0.9' } },
        all,
      ),
    ).toBe('en');
    // q=0 means "not this one": the tenant default applies
    expect(
      resolveLang({ headers: { 'accept-language': 'uz;q=0, de' } }, uzOnly),
    ).toBe('uz');
  });
  it("falls back to the tenant's default language, not a platform one", () => {
    expect(resolveLang({}, uzOnly)).toBe('uz');
    expect(
      resolveLang(
        { query: { lang: 'zz' }, headers: { 'accept-language': 'fr' } },
        uzOnly,
      ),
    ).toBe('uz');
  });
  it('ignores languages the tenant does not offer', () => {
    expect(
      resolveLang(
        { query: { lang: 'ru' }, headers: { 'accept-language': 'en,ru' } },
        uzOnly,
      ),
    ).toBe('uz');
    const ruEn = {
      languages: ['ru', 'en'] as const,
      defaultLanguage: 'en' as const,
    };
    expect(
      resolveLang({ headers: { 'accept-language': 'uz-UZ,ru;q=0.8' } }, ruEn),
    ).toBe('ru');
  });
});

describe('acceptedLanguages', () => {
  it('sorts by q, keeps the header order for equal q, drops q=0 and junk', () => {
    expect(acceptedLanguages('ru;q=0.1, en;q=0.9')).toEqual(['en', 'ru']);
    expect(acceptedLanguages('uz, ru;q=0.8, en;q=0.8, de;q=0')).toEqual([
      'uz',
      'ru',
      'en',
    ]);
    expect(acceptedLanguages('en;Q=0.5,uz')).toEqual(['uz', 'en']);
    expect(acceptedLanguages('fr;q=abc, ,ru')).toEqual(['ru']);
    expect(acceptedLanguages('')).toEqual([]);
  });
});

describe('pickTranslation', () => {
  const list = [
    { lang: 'en', t: 'E' },
    { lang: 'uz', t: 'U' },
  ];
  it("prefers the requested language, then the tenant's default, then anything", () => {
    expect(pickTranslation(list, 'en', 'ru')?.t).toBe('E');
    expect(pickTranslation(list, 'ru', 'uz')?.t).toBe('U'); // no ru → tenant default uz
    expect(pickTranslation(list, 'ru', 'en')?.t).toBe('E'); // no ru → tenant default en
    expect(pickTranslation([{ lang: 'de', t: 'D' }], 'ru', 'uz')?.t).toBe('D');
    expect(pickTranslation([], 'ru', 'uz')).toBeUndefined();
  });
});

describe('isLang', () => {
  it('accepts only ru, uz and en', () => {
    expect(['ru', 'uz', 'en'].every(isLang)).toBe(true);
    expect([' ru', 'RU', 'kk', '', null, 1].some(isLang)).toBe(false);
  });
});
