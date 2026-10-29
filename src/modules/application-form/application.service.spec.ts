jest.mock('src/infra/helper/tg-bot/otp-bot', () => ({ sendApplicationToTelegram: jest.fn() }));
import { ApplicationService } from './application.service';

describe('ApplicationService.create', () => {
  it('answers only the new id, not the stored row', async () => {
    const create = jest.fn(async ({ data }) => ({ id: 'app-1', created_at: new Date(), ...data }));
    const service = new ApplicationService({ application: { create } } as any);
    await expect(service.create({ fullName: 'A', phone: '+998901234567' } as any)).resolves.toEqual({ id: 'app-1' });
  });
});
