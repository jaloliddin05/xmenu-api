import { matchStreet, normalizeStreet } from './street-match';

const streets = [
  { id: 's-navoi', name: 'улица Навои', city: 'Ташкент' },
  { id: 's-temur', name: 'проспект Амира Темура', city: 'Ташкент' },
  { id: 's-bobur', name: "Bobur ko'chasi", city: 'Toshkent' },
  { id: 's-lenin-tash', name: 'Ленина', city: 'Ташкент' },
  { id: 's-lenin-sam', name: 'Ленина', city: 'Самарканд' },
  { id: 's-mustaqillik', name: 'Mustaqillik', city: 'Toshkent' },
];

describe('normalizeStreet', () => {
  it('drops street words, apostrophes, ё and case', () => {
    expect(normalizeStreet('Улица  Навои')).toBe('навои');
    expect(normalizeStreet("Bobur ko'chasi")).toBe('bobur');
    expect(normalizeStreet('Boburʻ koʻchasi')).toBe('bobur');
    expect(normalizeStreet('ул. Королёва')).toBe('королева');
  });
});

describe('matchStreet', () => {
  it('exact name and the house in the next part', () => {
    expect(matchStreet('Ташкент, улица Навои, 10', streets)).toEqual({
      streetId: 's-navoi',
      house: '10',
    });
  });

  it('normalized name: another street word, the house in the same part', () => {
    expect(matchStreet('Ташкент, ул. Навои 10а', streets)).toEqual({
      streetId: 's-navoi',
      house: '10а',
    });
    expect(matchStreet('Ташкент, Амира Темура пр-т, д. 7/2', streets)).toEqual({
      streetId: 's-temur',
      house: '7/2',
    });
  });

  it('uzbek Latin names with apostrophes', () => {
    expect(matchStreet('Toshkent, Bobur ko‘chasi, 5', streets)).toEqual({
      streetId: 's-bobur',
      house: '5',
    });
  });

  it('the same name in several cities: the city in the address decides, otherwise nothing', () => {
    expect(matchStreet('Самарканд, Ленина, 3', streets)).toEqual({
      streetId: 's-lenin-sam',
      house: '3',
    });
    expect(matchStreet('Ленина, 3', streets)).toBeNull();
  });

  it('no street, no house, two different streets: left to the operator', () => {
    expect(matchStreet('Ташкент, Неизвестная, 1', streets)).toBeNull();
    expect(matchStreet('Ташкент, улица Навои', streets)).toBeNull();
    expect(
      matchStreet('Ташкент, улица Навои, Mustaqillik, 4', streets),
    ).toBeNull();
    expect(matchStreet('', streets)).toBeNull();
    expect(matchStreet('Ташкент, улица Навои, 10', [])).toBeNull();
  });
});
