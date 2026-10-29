import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TelegramApiError } from './telegram-client';
import { TelegramBotService } from './telegram-bot.service';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const ORG = 'org-1';

function setup() {
  const rows = new Map<string, any>();
  const prisma = {
    organization_telegram_bot: {
      findUnique: jest.fn(async ({ where }: any) => {
        for (const r of rows.values()) {
          if (
            where.organization_id &&
            r.organization_id === where.organization_id
          )
            return r;
          if (
            where.telegram_bot_id &&
            r.telegram_bot_id === where.telegram_bot_id
          )
            return r;
          if (where.id && r.id === where.id) return r;
        }
        return null;
      }),
      upsert: jest.fn(async ({ create, update, where }: any) => {
        const existing = [...rows.values()].find(
          (r) => r.organization_id === where.organization_id,
        );
        // A new object, as Prisma returns: rows read earlier must not change under the caller
        const row = existing ? { ...existing, ...update } : { ...create };
        rows.set(row.organization_id, row);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) =>
        rows.delete(where.organization_id),
      ),
    },
  };
  // (token, method, payload): the payload is read back from mock.calls
  const client = {
    call: jest.fn<Promise<unknown>, [string, string, unknown?]>(
      async (_t, method) =>
        method === 'getMe'
          ? { id: 123456789, is_bot: true, username: 'mant_bot' }
          : true,
    ),
  };
  const svc = new TelegramBotService(prisma as any, client as any);
  return { svc, prisma, client, rows };
}

const withCode = (code: string) => ({
  response: expect.objectContaining({ code }),
});

describe('TelegramBotService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.PAYMENT_CONFIG_KEY = randomBytes(32).toString('base64');
    process.env.PUBLIC_API_URL = 'https://api.xmenu.uz';
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('rejects malformed tokens without calling Telegram', async () => {
    const { svc, client } = setup();
    await expect(svc.connect(ORG, 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.call).not.toHaveBeenCalled();
  });

  it('requires an https PUBLIC_API_URL', async () => {
    process.env.PUBLIC_API_URL = 'http://localhost:3000';
    const { svc, client } = setup();
    await expect(svc.connect(ORG, TOKEN)).rejects.toMatchObject(
      withCode('webhook_url_not_https'),
    );
    expect(client.call).not.toHaveBeenCalled();
  });

  it('rejects a token Telegram does not accept', async () => {
    const { svc, client } = setup();
    client.call.mockRejectedValueOnce(
      new TelegramApiError('getMe', 'Unauthorized', 401),
    );
    await expect(svc.connect(ORG, TOKEN)).rejects.toMatchObject(
      withCode('invalid_bot_token'),
    );
  });

  it('connects: registers the webhook with a secret, stores the token encrypted, never returns it', async () => {
    const { svc, client, rows } = setup();
    const status = await svc.connect(ORG, TOKEN);

    const webhookCall = client.call.mock.calls.find(
      (c: any[]) => c[1] === 'setWebhook',
    )!;
    const row = rows.get(ORG);
    expect(webhookCall[2]).toMatchObject({
      url: `https://api.xmenu.uz/telegram/bot/${row.id}/webhook`,
      secret_token: row.webhook_secret,
      allowed_updates: ['message'],
    });
    expect(row.token_encrypted).not.toContain(TOKEN);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(status).toMatchObject({
      connected: true,
      username: 'mant_bot',
      link: 'https://t.me/mant_bot',
    });

    const bot = await svc.forTenant(ORG);
    expect(bot).toMatchObject({
      token: TOKEN,
      username: 'mant_bot',
      organizationId: ORG,
    });
    expect(await svc.byKey(row.id)).toMatchObject({ token: TOKEN });
  });

  it('keeps the webhook URL stable when the same venue reconnects, with a fresh secret', async () => {
    const { svc, rows } = setup();
    await svc.connect(ORG, TOKEN);
    const first = { ...rows.get(ORG) };
    await svc.connect(ORG, TOKEN);
    expect(rows.get(ORG).id).toBe(first.id);
    expect(rows.get(ORG).webhook_secret).not.toBe(first.webhook_secret);
  });

  it('drops the old webhook when the venue switches to another bot', async () => {
    const { svc, client } = setup();
    await svc.connect(ORG, TOKEN);
    client.call.mockImplementation(async (_t: string, method: string) =>
      method === 'getMe'
        ? { id: 987654321, is_bot: true, username: 'new_bot' }
        : true,
    );
    const other = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
    await expect(svc.connect(ORG, other)).resolves.toMatchObject({
      username: 'new_bot',
    });
    const drop = client.call.mock.calls.find(
      (c: any[]) => c[1] === 'deleteWebhook',
    );
    expect(drop?.[0]).toBe(TOKEN);
  });

  it('refuses a bot that already belongs to another venue', async () => {
    const { svc } = setup();
    await svc.connect('org-2', TOKEN);
    const p = svc.connect(ORG, TOKEN);
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expect(p).rejects.toMatchObject(withCode('bot_already_connected'));
  });

  it('stores nothing when Telegram refuses the webhook', async () => {
    const { svc, client, rows } = setup();
    client.call.mockImplementation(async (_t, method) => {
      if (method === 'getMe') return { id: 1, is_bot: true, username: 'b_bot' };
      throw new TelegramApiError('setWebhook', 'bad webhook', 400);
    });
    await expect(svc.connect(ORG, TOKEN)).rejects.toMatchObject(
      withCode('webhook_setup_failed'),
    );
    expect(rows.size).toBe(0);
  });

  it('disconnect removes the webhook and the row', async () => {
    const { svc, client, rows } = setup();
    await svc.connect(ORG, TOKEN);
    await svc.disconnect(ORG);
    expect(
      client.call.mock.calls.some((c: any[]) => c[1] === 'deleteWebhook'),
    ).toBe(true);
    expect(rows.size).toBe(0);
    expect(await svc.forTenant(ORG)).toBeNull();
    expect(await svc.status(ORG)).toMatchObject({ connected: false });
  });

  it('initDataToken falls back to the platform bot until the venue connects its own', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'platform:token';
    const { svc } = setup();
    expect(await svc.initDataToken(ORG)).toBe('platform:token');
    await svc.connect(ORG, TOKEN);
    expect(await svc.initDataToken(ORG)).toBe(TOKEN);
  });
});
