import { ADDRESS_LIMITS, normalizeAddressInput } from './address-validators';

const ok = (input: Parameters<typeof normalizeAddressInput>[0]) => {
  const result = normalizeAddressInput(input);
  if (!result.ok)
    throw new Error(`expected ok, got ${result.field}: ${result.message}`);
  return result.value;
};

const failure = (input: Parameters<typeof normalizeAddressInput>[0]) => {
  const result = normalizeAddressInput(input);
  if (result.ok) throw new Error('expected a validation failure');
  return result;
};

describe('normalizeAddressInput', () => {
  describe('address', () => {
    it('accepts a minimal address and fills the optional fields with null', () => {
      expect(ok({ address: 'Shamol oti ko‘chasi 42' })).toEqual({
        title: null,
        address: 'Shamol oti ko‘chasi 42',
        latitude: null,
        longitude: null,
        entrance: null,
        floor: null,
        apartment: null,
        comment: null,
      });
    });

    it('trims and collapses inner whitespace, including pasted line breaks', () => {
      expect(ok({ address: '  Shamol   oti\n 42  ' }).address).toBe(
        'Shamol oti 42',
      );
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['not a string', 42],
      ['blank', '   '],
    ])('rejects an address that is %s', (_label, address) => {
      expect(failure({ address }).field).toBe('address');
    });

    it('enforces the length bounds on both sides', () => {
      expect(
        ok({ address: 'a'.repeat(ADDRESS_LIMITS.addressMin) }).address,
      ).toHaveLength(ADDRESS_LIMITS.addressMin);
      expect(
        failure({ address: 'a'.repeat(ADDRESS_LIMITS.addressMin - 1) }).field,
      ).toBe('address');
      expect(
        ok({ address: 'a'.repeat(ADDRESS_LIMITS.address) }).address,
      ).toHaveLength(ADDRESS_LIMITS.address);
      expect(
        failure({ address: 'a'.repeat(ADDRESS_LIMITS.address + 1) }).field,
      ).toBe('address');
    });

    it('counts code points, not UTF-16 units (an emoji is one character)', () => {
      const emoji = '\u{1F3E0}'; // 🏠 — two UTF-16 units
      expect(
        ok({ address: emoji.repeat(ADDRESS_LIMITS.address) }).address,
      ).toBe(emoji.repeat(ADDRESS_LIMITS.address));
    });

    it('rejects invisible/control characters that are not plain whitespace', () => {
      expect(failure({ address: 'Shamol\u0000oti' }).field).toBe('address');
      expect(failure({ address: 'Shamol\u200doti' }).field).toBe('address'); // zero-width joiner
    });
  });

  describe('title and short fields', () => {
    it('turns blank optional fields into null', () => {
      const value = ok({
        address: 'Shamol oti 42',
        title: '  ',
        entrance: '',
        floor: null,
        apartment: undefined,
      });
      expect(value.title).toBeNull();
      expect(value.entrance).toBeNull();
      expect(value.floor).toBeNull();
      expect(value.apartment).toBeNull();
    });

    it('keeps and cleans provided values', () => {
      const value = ok({
        address: 'Shamol oti 42',
        title: '  Uy ',
        entrance: ' 2 ',
        floor: '5',
        apartment: ' 17  A ',
      });
      expect(value).toMatchObject({
        title: 'Uy',
        entrance: '2',
        floor: '5',
        apartment: '17 A',
      });
    });

    it.each([
      ['title', ADDRESS_LIMITS.title],
      ['entrance', ADDRESS_LIMITS.shortField],
      ['floor', ADDRESS_LIMITS.shortField],
      ['apartment', ADDRESS_LIMITS.shortField],
    ] as const)(
      '%s allows exactly %i characters and rejects one more',
      (field, max) => {
        expect(
          ok({ address: 'Shamol oti 42', [field]: 'x'.repeat(max) })[field],
        ).toHaveLength(max);
        expect(
          failure({ address: 'Shamol oti 42', [field]: 'x'.repeat(max + 1) })
            .field,
        ).toBe(field);
      },
    );

    it('rejects a non-string value rather than coercing it', () => {
      expect(failure({ address: 'Shamol oti 42', apartment: 12 }).field).toBe(
        'apartment',
      );
    });
  });

  describe('comment', () => {
    it('keeps line breaks (it is a textarea) but normalises them', () => {
      expect(
        ok({ address: 'Shamol oti 42', comment: 'Darvoza\r\nko‘k  rangda' })
          .comment,
      ).toBe('Darvoza\nko‘k rangda');
    });

    it('collapses runs of blank lines to a single blank line', () => {
      expect(
        ok({ address: 'Shamol oti 42', comment: 'bir\n\n\n\n\niki' }).comment,
      ).toBe('bir\n\niki');
    });

    it('treats whitespace-only text as absent', () => {
      expect(
        ok({ address: 'Shamol oti 42', comment: ' \n\t ' }).comment,
      ).toBeNull();
    });

    it('allows exactly the maximum and rejects one more', () => {
      expect(
        ok({
          address: 'Shamol oti 42',
          comment: 'x'.repeat(ADDRESS_LIMITS.comment),
        }).comment,
      ).toHaveLength(ADDRESS_LIMITS.comment);
      expect(
        failure({
          address: 'Shamol oti 42',
          comment: 'x'.repeat(ADDRESS_LIMITS.comment + 1),
        }).field,
      ).toBe('comment');
    });

    it('rejects control and invisible characters other than line breaks', () => {
      expect(
        failure({ address: 'Shamol oti 42', comment: 'a\u0000b' }).field,
      ).toBe('comment');
      expect(
        failure({ address: 'Shamol oti 42', comment: 'a\u200db' }).field,
      ).toBe('comment');
    });
  });

  describe('coordinates', () => {
    it('accepts a valid pair and rounds it to 6 decimals', () => {
      const value = ok({
        address: 'Shamol oti 42',
        latitude: 41.31108123456789,
        longitude: 69.24056199999,
      });
      expect(value.latitude).toBe(41.311081);
      expect(value.longitude).toBe(69.240562);
    });

    it('treats a missing pair as no coordinates', () => {
      expect(
        ok({ address: 'Shamol oti 42', latitude: null, longitude: undefined }),
      ).toMatchObject({
        latitude: null,
        longitude: null,
      });
    });

    it('accepts 0 — a falsy but perfectly valid coordinate', () => {
      expect(
        ok({ address: 'Shamol oti 42', latitude: 0, longitude: 0 }),
      ).toMatchObject({ latitude: 0, longitude: 0 });
    });

    it('accepts the exact limits', () => {
      expect(
        ok({ address: 'Shamol oti 42', latitude: 90, longitude: 180 }),
      ).toMatchObject({
        latitude: 90,
        longitude: 180,
      });
      expect(
        ok({ address: 'Shamol oti 42', latitude: -90, longitude: -180 }),
      ).toMatchObject({
        latitude: -90,
        longitude: -180,
      });
    });

    it('rejects a lone coordinate and names the missing one', () => {
      expect(failure({ address: 'Shamol oti 42', latitude: 41.3 }).field).toBe(
        'longitude',
      );
      expect(failure({ address: 'Shamol oti 42', longitude: 69.2 }).field).toBe(
        'latitude',
      );
    });

    it.each([
      [
        'latitude above range',
        { latitude: 90.0001, longitude: 69 },
        'latitude',
      ],
      [
        'latitude below range',
        { latitude: -90.0001, longitude: 69 },
        'latitude',
      ],
      [
        'longitude above range',
        { latitude: 41, longitude: 180.0001 },
        'longitude',
      ],
      [
        'longitude below range',
        { latitude: 41, longitude: -180.0001 },
        'longitude',
      ],
      [
        'a mistyped latitude (411.31)',
        { latitude: 411.31, longitude: 69 },
        'latitude',
      ],
      ['NaN', { latitude: NaN, longitude: 69 }, 'latitude'],
      ['Infinity', { latitude: 41, longitude: Infinity }, 'longitude'],
      ['numeric strings', { latitude: '41.3', longitude: '69.2' }, 'latitude'],
    ])('rejects %s', (_label, coords, field) => {
      expect(failure({ address: 'Shamol oti 42', ...coords }).field).toBe(
        field,
      );
    });
  });
});
