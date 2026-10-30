import {
  BOT_PROFILE_LIMITS,
  deliveryUrl,
  defaultProfileFor,
  resolveProfile,
  truncate,
  validateProfileInput,
} from './bot-profile';

const VENUE = {
  name: 'Mant',
  descriptions: { ru: 'Лучший плов в городе' } as Record<string, string>,
  defaultLanguage: 'ru' as const,
};

describe('bot profile defaults', () => {
  it('builds the profile from the venue name and description', () => {
    expect(defaultProfileFor('ru', VENUE)).toEqual({
      name: 'Mant',
      description: 'Лучший плов в городе',
      shortDescription: 'Лучший плов в городе',
      menuButtonText: 'Меню',
    });
  });

  it('falls back to the default-language description, then to a generic line', () => {
    expect(defaultProfileFor('uz', VENUE).description).toBe(
      'Лучший плов в городе',
    );
    const bare = { ...VENUE, descriptions: {} };
    expect(defaultProfileFor('en', bare).description).toContain('Mant');
    expect(defaultProfileFor('uz', bare).menuButtonText).toBe('Menyu');
  });

  it('cuts to Telegram limits', () => {
    const long = {
      ...VENUE,
      name: 'N'.repeat(100),
      descriptions: { ru: 'D'.repeat(700) },
    };
    const p = defaultProfileFor('ru', long);
    expect(p.name).toHaveLength(BOT_PROFILE_LIMITS.name);
    expect(p.description).toHaveLength(BOT_PROFILE_LIMITS.description);
    expect(p.shortDescription).toHaveLength(
      BOT_PROFILE_LIMITS.shortDescription,
    );
  });

  it('truncate does not split a surrogate pair', () => {
    expect(truncate('😀😀😀', 2)).toBe('😀😀');
  });

  it('saved fields win over defaults, the rest is filled in, only venue languages appear', () => {
    const out = resolveProfile(
      { ru: { name: 'Мой плов' }, en: { name: 'ignored' } },
      ['ru', 'uz'],
      VENUE,
    );
    expect(Object.keys(out)).toEqual(['ru', 'uz']);
    expect(out.ru.name).toBe('Мой плов');
    expect(out.ru.menuButtonText).toBe('Меню');
    expect(out.uz.name).toBe('Mant');
  });
});

describe('validateProfileInput', () => {
  const ok = {
    name: 'Mant',
    description: '',
    shortDescription: 'Plov',
    menuButtonText: 'Menu',
  };

  it('accepts a valid profile and trims text', () => {
    const r = validateProfileInput({ ru: { ...ok, name: '  Mant ' } }, [
      'ru',
      'uz',
    ]);
    expect(r).toEqual({ profile: { ru: { ...ok, name: 'Mant' } } });
  });

  it('names the failing field: length, empty, type, language, unknown key', () => {
    const r = validateProfileInput(
      {
        ru: {
          ...ok,
          name: 'x'.repeat(65),
          shortDescription: ' ',
          menuButtonText: 5,
          extra: 1,
        },
        de: ok,
        uz: ok,
      },
      ['ru', 'uz'],
    );
    if (!('errors' in r)) throw new Error('expected errors');
    const byField = Object.fromEntries(
      r.errors.map((e) => [e.field, e.reason]),
    );
    expect(byField).toMatchObject({
      'ru.name': 'maxLength',
      'ru.shortDescription': 'isNotEmpty',
      'ru.menuButtonText': 'isString',
      'ru.extra': 'whitelistValidation',
      de: 'notInLanguages',
    });
    expect(byField['uz.name']).toBeUndefined();
  });

  it('rejects a non-object profile', () => {
    expect(validateProfileInput(null, ['ru'])).toHaveProperty('errors');
    expect(validateProfileInput([], ['ru'])).toHaveProperty('errors');
  });
});

describe('deliveryUrl', () => {
  it('substitutes the slug into an https template', () => {
    expect(deliveryUrl('mant', 'https://{slug}.xmenu.uz')).toBe(
      'https://mant.xmenu.uz',
    );
  });

  it('is null without a template, a {slug} placeholder, a slug or https', () => {
    expect(deliveryUrl('mant', undefined)).toBeNull();
    expect(deliveryUrl('mant', 'https://xmenu.uz')).toBeNull();
    expect(deliveryUrl(null, 'https://{slug}.xmenu.uz')).toBeNull();
    expect(deliveryUrl('mant', 'http://{slug}.localhost')).toBeNull();
  });
});
