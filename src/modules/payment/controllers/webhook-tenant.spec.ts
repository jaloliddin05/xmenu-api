import { CLICK_ERROR } from '../domain/click-protocol';
import { PAYME_ERROR } from '../domain/payme-protocol';
import { ClickController } from './click.controller';
import { PaymeController } from './payme.controller';
import { PaymentProviderController } from './payment-provider.controller';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

/** Webhook URLs carry the organization id; a slug in their place is an unknown merchant. */
describe('payment webhooks: tenant by id only', () => {
  let findUnique: jest.Mock;
  let configs: { getClick: jest.Mock; getPayme: jest.Mock };

  beforeEach(() => {
    findUnique = jest.fn(async ({ where }) =>
      where.id === ID ? { id: ID, is_active: true } : null,
    );
    // No keys configured: a known tenant still fails, but only after being looked up by id
    configs = {
      getClick: jest.fn(async () => null),
      getPayme: jest.fn(async () => null),
    };
  });

  const prisma = () => ({ organization: { findUnique } }) as any;

  it('Click: a slug is refused without a lookup', async () => {
    const click = new ClickController(prisma(), configs as any, {} as any);
    const res = await click.prepare('mant', { click_trans_id: 1 } as any);
    expect(res).toMatchObject({ error: CLICK_ERROR.BAD_REQUEST });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('Click: looks the tenant up by id', async () => {
    const click = new ClickController(prisma(), configs as any, {} as any);
    await click.complete(ID.toUpperCase(), {} as any);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
    expect(configs.getClick).toHaveBeenCalledWith(ID);
  });

  it('Payme: a slug gets the same answer as a wrong password', async () => {
    const payme = new PaymeController(prisma(), configs as any, {} as any);
    const res: any = await payme.handle('mant', 'Basic x', {
      id: 7,
      method: 'CheckPerformTransaction',
    } as any);
    expect(res.error.code).toBe(PAYME_ERROR.INSUFFICIENT_PRIVILEGE);
    expect(findUnique).not.toHaveBeenCalled();

    await payme.handle(ID, 'Basic x', { id: 8 } as any);
    expect(configs.getPayme).toHaveBeenCalledWith(ID);
  });

  it('GET /payment-provider gives webhook URLs on the organization id', async () => {
    process.env.PUBLIC_API_URL = 'https://api.example.uz/';
    const list = { list: jest.fn(async () => []) };
    const res = await new PaymentProviderController(list as any).list({
      user: { organization: { id: ID } },
    });
    expect(res.webhooks).toEqual({
      click: {
        prepare: `https://api.example.uz/payments/click/${ID}/prepare`,
        complete: `https://api.example.uz/payments/click/${ID}/complete`,
      },
      payme: { endpoint: `https://api.example.uz/payments/payme/${ID}` },
    });
    delete process.env.PUBLIC_API_URL;
  });
});
