import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import UpdateOrganizationDto from '../dto/update-organization.dto';
import { isValidSlug, slugify } from './slug';

describe('slug rules', () => {
  it.each(['mant', 'cafe-24', 'a1b', 'x'.repeat(63)])('accepts %p', (s) =>
    expect(isValidSlug(s)).toBe(true),
  );

  it.each([
    ['too short', 'ab'],
    ['too long', 'x'.repeat(64)],
    ['slash', 'mant/menu'],
    ['path', '../mant'],
    ['upper case', 'Mant'],
    ['underscore', 'mant_cafe'],
    ['leading dash', '-mant'],
    ['trailing dash', 'mant-'],
    ['double dash', 'mant--cafe'],
    ['space', 'mant cafe'],
    ['cyrillic', 'мант'],
    ['uuid', '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'],
    ['not a string', 42],
  ])('refuses %s', (_why, s) => expect(isValidSlug(s)).toBe(false));

  it('proposes a valid slug from a name', () => {
    expect(slugify('  Cafe  Example_24! ')).toBe('cafe-example-24');
    expect(slugify('Burger--King')).toBe('burger-king');
  });

  it('gives names without latin letters a random valid slug', () => {
    for (const name of ['Мант', '', '!!!', 'ab']) {
      const s = slugify(name);
      expect(s).toMatch(/^venue-[a-z0-9]{6}$/);
      expect(isValidSlug(s)).toBe(true);
    }
  });

  it('keeps proposals within the length limit', () => {
    expect(slugify('a'.repeat(100), 59)).toHaveLength(59);
  });

  it('UpdateOrganizationDto validates slug with the same rules', async () => {
    const errors = async (slug: unknown) =>
      (await validate(plainToInstance(UpdateOrganizationDto, { slug }))).map(
        (e) => e.property,
      );
    expect(await errors('cafe-example')).toEqual([]);
    expect(await errors('mant/menu')).toEqual(['slug']);
    expect(await errors('3F2B8C1E-4D5A-4B6C-8D7E-9F0A1B2C3D4E')).toEqual([
      'slug',
    ]);
  });
});
