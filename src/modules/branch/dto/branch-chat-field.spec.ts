import { createValidationPipe } from 'src/infra/validators/validation-errors';
import { CreateBranchDto, UpdateBranchDto } from './branch.dto';

const pipe = createValidationPipe();
const run = (metatype: any, body: object) =>
  pipe.transform(body, { type: 'body', metatype });

describe('branch chat is not typed in (S-09)', () => {
  it.each([
    ['POST /branch', CreateBranchDto],
    ['PATCH /branch/:id', UpdateBranchDto],
  ])('%s refuses telegramChatId with 400 validation_error', async (_r, dto) => {
    await expect(
      run(dto, { telegramChatId: '-1001234567890' }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });
});
