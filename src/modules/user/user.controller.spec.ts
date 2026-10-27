import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

const ME = { user: { id: 'user-me' } };
const OTHER_ID = 'user-other';

describe('UserController: only your own account', () => {
  const service = {
    update: jest.fn(async (id: string) => ({ id })),
    changePassword: jest.fn(async (_d: unknown, id: string) => ({ id })),
    delete: jest.fn(async (id: string) => ({ id })),
    findOne: jest.fn(),
  };
  const controller = new UserController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['update', () => controller.update({} as any, OTHER_ID, ME, undefined as any)],
    ['change-password', () => controller.changePassword({} as any, OTHER_ID, ME)],
    ['delete', () => controller.remove(OTHER_ID, ME)],
  ])('%s on someone else is 404 and never reaches the service', async (_name, call) => {
    await expect(Promise.resolve().then(call)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.changePassword).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('works on your own id', async () => {
    await controller.update({} as any, ME.user.id, ME, undefined as any);
    await controller.changePassword({} as any, ME.user.id, ME);
    await controller.remove(ME.user.id, ME);
    expect(service.update).toHaveBeenCalledWith(ME.user.id, {}, undefined);
    expect(service.changePassword).toHaveBeenCalledWith({}, ME.user.id);
    expect(service.delete).toHaveBeenCalledWith(ME.user.id);
  });

  it('no longer exposes listing or creating users', () => {
    expect((controller as any).findAll).toBeUndefined();
    expect((controller as any).create).toBeUndefined();
  });
});

describe('UserService.changePassword', () => {
  function serviceWith(user: Record<string, unknown> | null) {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
    };
    return new UserService(prisma as any, {} as any);
  }

  it('rejects an account without a password instead of crashing', async () => {
    await expect(
      serviceWith({ id: 'u', password: null }).changePassword(
        { oldPassword: 'x', newPassword: 'new-password' },
        'u',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never returns the new hash', async () => {
    const bcrypt = jest.requireActual('bcrypt');
    const res = await serviceWith({ id: 'u', password: await bcrypt.hash('old-password', 4) }).changePassword(
      { oldPassword: 'old-password', newPassword: 'new-password' },
      'u',
    );
    expect(res).not.toHaveProperty('password');
  });
});
