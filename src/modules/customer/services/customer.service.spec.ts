import { AppException } from 'src/infra/errors/app-exception';
import { CustomerService } from './customer.service';

const row = {
  id: 'c1',
  phone: '+998901234567',
  name: 'Ali',
  language: null as string | null,
  status: 'active',
};

function setup() {
  const repo = {
    findById: jest.fn(async () => ({ ...row })),
    update: jest.fn(async () => ({ count: 1 })),
  };
  const service = new CustomerService(repo as never);
  return { repo, service };
}

async function code(p: Promise<unknown>) {
  return p.catch((e: AppException) => e.code);
}

describe('CustomerService.updateMe language', () => {
  it('stores a language the venue offers', async () => {
    const { repo, service } = setup();
    const user = await service.updateMe('t', 'c1', { language: 'uz' }, [
      'ru',
      'uz',
    ]);
    expect(repo.update).toHaveBeenCalledWith('t', 'c1', { language: 'uz' });
    expect(user).toEqual({ ...user, language: 'uz', name: 'Ali' });
  });

  it('rejects a language the venue does not offer or an unknown one', async () => {
    const { repo, service } = setup();
    expect(
      await code(service.updateMe('t', 'c1', { language: 'en' }, ['ru'])),
    ).toBe('language_not_supported');
    expect(
      await code(service.updateMe('t', 'c1', { language: 'de' }, ['ru'])),
    ).toBe('language_not_supported');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('needs at least one field, and still validates the name', async () => {
    const { service } = setup();
    expect(await code(service.updateMe('t', 'c1', {}, ['ru']))).toBe(
      'validation_error',
    );
    expect(await code(service.updateMe('t', 'c1', { name: ' ' }, ['ru']))).toBe(
      'invalid_name',
    );
  });

  it('changes the name alone without touching the language', async () => {
    const { repo, service } = setup();
    await service.updateMe('t', 'c1', { name: 'Vali' }, ['ru']);
    expect(repo.update).toHaveBeenCalledWith('t', 'c1', { name: 'Vali' });
  });
});
