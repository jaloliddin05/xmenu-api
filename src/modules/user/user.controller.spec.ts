import { UserController } from './user.controller';

const ME = { user: { id: 'user-me' } };
const OTHER_ID = 'user-other';

describe('UserController: only your own account', () => {
  const service = {
    update: jest.fn(async (id: string) => ({ id })),
    delete: jest.fn(async (id: string) => ({ id })),
    findOne: jest.fn(),
  };
  const controller = new UserController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      'update',
      () => controller.update({} as any, OTHER_ID, ME, undefined as any),
    ],
    ['delete', () => controller.remove(OTHER_ID, ME)],
  ])(
    '%s on someone else is 404 and never reaches the service',
    async (_name, call) => {
      await expect(Promise.resolve().then(call)).rejects.toMatchObject({
        code: 'not_found',
      });
      expect(service.update).not.toHaveBeenCalled();
      expect(service.delete).not.toHaveBeenCalled();
    },
  );

  it('works on your own id', async () => {
    await controller.update({} as any, ME.user.id, ME, undefined as any);
    await controller.remove(ME.user.id, ME);
    expect(service.update).toHaveBeenCalledWith(ME.user.id, {}, undefined);
    expect(service.delete).toHaveBeenCalledWith(ME.user.id);
  });

  it('no longer exposes listing or creating users', () => {
    expect((controller as any).findAll).toBeUndefined();
    expect((controller as any).create).toBeUndefined();
  });
});
