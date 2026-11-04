jest.mock('src/infra/helper/tg-bot/otp-bot', () => ({
  sendApplicationToTelegram: jest.fn(),
}));
import { Logger } from '@nestjs/common';
import { sendApplicationToTelegram } from 'src/infra/helper/tg-bot/otp-bot';
import { ApplicationService } from './application.service';

describe('ApplicationService.create', () => {
  it('answers only the new id, not the stored row', async () => {
    const create = jest.fn(async ({ data }) => ({
      id: 'app-1',
      created_at: new Date(),
      ...data,
    }));
    const service = new ApplicationService({ application: { create } } as any);
    await expect(
      service.create({ fullName: 'A', phone: '+998901234567' } as any),
    ).resolves.toEqual({ id: 'app-1' });
  });

  it('saves and answers the id when Telegram fails; the log has the reason, not the token', async () => {
    const create = jest.fn(async ({ data }) => ({ id: 'app-2', ...data }));
    (sendApplicationToTelegram as jest.Mock).mockRejectedValueOnce(
      new Error('Telegram sendMessage failed: Bad Request: chat not found'),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new ApplicationService({ application: { create } } as any);

    await expect(
      service.create({ from: 'web', fullName: 'Ali_*[' } as any),
    ).resolves.toEqual({ id: 'app-2' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('chat not found'),
    );
    warn.mockRestore();
  });

  it('does not touch Telegram before the row is saved', async () => {
    const order: string[] = [];
    const create = jest.fn(async () => (order.push('db'), { id: 'app-3' }));
    (sendApplicationToTelegram as jest.Mock).mockImplementationOnce(
      async () => void order.push('tg'),
    );
    await new ApplicationService({ application: { create } } as any).create({
      from: 'web',
    } as any);
    expect(order).toEqual(['db', 'tg']);
  });
});
