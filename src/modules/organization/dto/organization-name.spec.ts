import { createValidationPipe } from 'src/infra/validators/validation-errors';
import { StaffRegisterDto } from 'src/modules/auth/dto/staff-register.dto';
import CreateOrganizationDto from './create-organization.dto';
import UpdateOrganizationDto from './update-organization.dto';

const pipe = createValidationPipe();
const run = (metatype: any, body: object) =>
  pipe.transform(body, { type: 'body', metatype });

const register = (name: unknown) => ({
  phone: '+998901234567',
  password: 'secret-pass-1',
  type: 'cafe',
  first_name: 'Ali',
  name,
});

describe('venue name: trimmed, 2-100 characters', () => {
  it('PUT /organization/:id trims the name', async () => {
    const dto = await run(UpdateOrganizationDto, { name: '  Кафе  ' });
    expect(dto.name).toBe('Кафе');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '    '],
    ['one character', 'A'],
    ['101 characters', 'x'.repeat(101)],
  ])(
    'PUT /organization/:id rejects %s with fields[] on `name`',
    async (_t, name) => {
      await expect(run(UpdateOrganizationDto, { name })).rejects.toMatchObject({
        response: {
          code: 'validation_error',
          fields: [expect.objectContaining({ field: 'name' })],
        },
      });
    },
  );

  it('PUT /organization/:id still allows leaving the name out', async () => {
    await expect(
      run(UpdateOrganizationDto, { type: 'cafe' }),
    ).resolves.toBeDefined();
  });

  it('creating an organization needs 2-100 characters after trimming', async () => {
    await expect(
      run(CreateOrganizationDto, { type: 'cafe', name: ' Ab ' }),
    ).resolves.toMatchObject({ name: 'Ab' });
    for (const name of ['', '  ', 'A', 'x'.repeat(101)]) {
      await expect(
        run(CreateOrganizationDto, { type: 'cafe', name }),
      ).rejects.toBeDefined();
    }
  });

  it('registration needs 2-100 characters after trimming', async () => {
    await expect(
      run(StaffRegisterDto, register('  Mant  ')),
    ).resolves.toMatchObject({ name: 'Mant' });
    for (const name of ['', '  ', 'A', 'x'.repeat(101)]) {
      await expect(run(StaffRegisterDto, register(name))).rejects.toBeDefined();
    }
  });
});
