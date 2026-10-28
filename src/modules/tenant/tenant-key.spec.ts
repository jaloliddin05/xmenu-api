import { parseTenantId } from './tenant-key';

describe('parseTenantId', () => {
  const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

  it('accepts an organization id and lower-cases it', () => {
    expect(parseTenantId(ID)).toBe(ID);
    expect(parseTenantId(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  it.each([
    undefined,
    null,
    '',
    '   ',
    'mant',
    'mant-2',
    `${ID}x`,
    ID.slice(1),
    '../etc',
  ])('rejects %p (slugs are not tenant keys)', (key) =>
    expect(parseTenantId(key)).toBeNull(),
  );
});
