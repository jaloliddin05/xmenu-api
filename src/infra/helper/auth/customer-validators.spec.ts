import {
  isValidPhone,
  maskPhone,
  normalizeCustomerName,
} from './customer-validators';

describe('isValidPhone', () => {
  it('accepts a well-formed Uzbek E.164 number', () => {
    expect(isValidPhone('+998901234567')).toBe(true);
  });

  it.each([
    ['missing the leading +', '998901234567'],
    ['one digit short', '+99890123456'],
    ['one digit too many', '+9989012345678'],
    ['wrong country code', '+7901234567890'],
    ['contains a non-digit', '+99890123456a'],
    ['contains spaces', '+998 90 123 45 67'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, input) => {
    expect(isValidPhone(input)).toBe(false);
  });

  it.each([null, undefined, 998901234567, {}, ['+998901234567']])(
    'rejects non-string input: %p',
    (input) => {
      expect(isValidPhone(input)).toBe(false);
    },
  );
});

describe('maskPhone', () => {
  it('keeps the country code and last 4 digits, masks the middle', () => {
    expect(maskPhone('+998901234567')).toBe('+99890***4567');
  });

  it('returns null for null/undefined/empty input', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('')).toBeNull();
  });

  it('falls back to a flat mask for strings shorter than 10 chars', () => {
    expect(maskPhone('12345')).toBe('***');
  });
});

describe('normalizeCustomerName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeCustomerName('  Ali  ')).toBe('Ali');
  });

  it('collapses repeated internal whitespace to a single space', () => {
    expect(normalizeCustomerName('Ali   Vali')).toBe('Ali Vali');
  });

  it.each([
    ['exactly the 2-char minimum', 'Al'],
    ['exactly the 50-char maximum', 'A'.repeat(50)],
  ])('accepts %s', (_label, input) => {
    expect(normalizeCustomerName(input)).toBe(input);
  });

  it.each([
    ['empty string', ''],
    ['a single character', 'A'],
    ['only whitespace (collapses below the minimum)', '   '],
    ['51 characters', 'A'.repeat(51)],
  ])('rejects %s', (_label, input) => {
    expect(normalizeCustomerName(input)).toBeNull();
  });

  it.each([
    ['a newline', 'Ali\nVali'],
    ['a tab', 'Ali\tVali'],
    ['a null byte', 'Ali\u0000Vali'],
    ['a zero-width joiner (format char)', 'Ali\u200dVali'],
  ])('rejects a name containing %s', (_label, input) => {
    expect(normalizeCustomerName(input)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizeCustomerName(123 as unknown)).toBeNull();
    expect(normalizeCustomerName(null)).toBeNull();
    expect(normalizeCustomerName(undefined)).toBeNull();
  });

  // Array.from() walks Unicode code points, not UTF-16 code units — an
  // astral character (e.g. an emoji) is one code point but two code units,
  // so a naive `.length` check would both over-count length here and risk
  // splitting the surrogate pair when truncating. This name is exactly 2
  // code points (an astral emoji + "A") and must be accepted, not rejected
  // as "too long" the way `.length` (which would read 3) would have it.
  it('counts Unicode code points, not UTF-16 code units', () => {
    const astral = '\u{1F600}'; // 😀 — one code point, two UTF-16 units
    expect(astral.length).toBe(2);
    expect(normalizeCustomerName(`${astral}A`)).toBe(`${astral}A`);
  });
});
