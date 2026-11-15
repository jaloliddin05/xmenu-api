import { AuthService } from './auth.service';

function serviceWith(findOne: (id: string) => Promise<unknown>) {
  return new AuthService({ findOne } as any, { getJWT: () => 'jwt' } as any);
}

describe('AuthService.validateUserById', () => {
  it('returns an active user with a role in a venue', async () => {
    const user = { id: 'u1', isActive: true, role: 'operator' };
    await expect(
      serviceWith(async () => user).validateUserById('u1'),
    ).resolves.toBe(user);
  });

  it.each([
    ['a deleted user', async () => null],
    ['an unconfirmed user', async () => ({ id: 'u1', isActive: false })],
    [
      'a user without an active membership (disabled operator)',
      async () => ({ id: 'u1', isActive: true, role: null }),
    ],
    [
      'a lookup error (e.g. no sub in the token)',
      async () => Promise.reject(new Error('bad id')),
    ],
  ])('rejects %s with 401', async (_name, findOne) => {
    await expect(
      serviceWith(findOne).validateUserById('u1'),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
