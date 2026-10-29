import { HttpException } from '@nestjs/common';
import { TranslationService } from './translation.service';

describe('TranslationService without OPENAI_API_KEY', () => {
  const saved = process.env.OPENAI_API_KEY;
  beforeEach(() => delete process.env.OPENAI_API_KEY);
  afterAll(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });

  it('is constructed without a key, so the API starts', () => {
    expect(() => new TranslationService({} as never)).not.toThrow();
  });

  it('answers 503 translation_unavailable and never touches the database', async () => {
    const findFirst = jest.fn();
    const service = new TranslationService({
      translation_prompt: { findFirst },
    } as never);
    const err = await service
      .translate('Плов', 'dish')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'translation_unavailable',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('treats a blank key as missing', async () => {
    process.env.OPENAI_API_KEY = '   ';
    const service = new TranslationService({} as never);
    await expect(service.translate('x', 'dish')).rejects.toMatchObject({
      status: 503,
    });
  });
});
