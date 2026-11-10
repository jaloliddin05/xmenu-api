import { platformMisconfigured } from 'src/infra/errors/app-exception';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { hashWebhookSecret } from 'src/modules/telegram/domain/webhook-secret';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { InProcessTelegramUpdateQueue } from '../services/telegram-update-queue.fake';
import { processTelegramUpdate } from '../services/telegram-update.processor';
import { TELEGRAM_UPDATE_QUEUE } from '../services/telegram-update.queue';
import { TelegramVerificationService } from '../services/telegram-verification.service';
import { TelegramBotWebhookController } from './telegram-bot-webhook.controller';

const BOT_KEY = '0b6a6c3e-7c1f-4b8e-9d4e-3f2a1b0c9d8e';
const SECRET = 'f'.repeat(64);
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const BOT = {
  botKey: BOT_KEY,
  organizationId: 'tenant-1',
  username: 'mant_bot',
  token: TOKEN,
  webhookSecretHash: hashWebhookSecret(SECRET),
};
const USER_ID = 555;

const startUpdate = (updateId: number) => ({
  update_id: updateId,
  message: {
    chat: { id: USER_ID, type: 'private' },
    from: { id: USER_ID, language_code: 'ru' },
    text: '/start',
  },
});

/** A Telegram that does not answer sendMessage until the test lets it. */
function slowTelegram() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sendMessage: unknown[] = [];
  let answered = 0;
  const client = {
    call: jest.fn(async (_token: string, method: string, payload: unknown) => {
      if (method !== 'sendMessage') return true;
      sendMessage.push(payload);
      await gate;
      answered++;
      return { message_id: 1 };
    }),
  };
  return { client, sendMessage, release, answered: () => answered };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}

describe('POST /telegram/bot/:botKey/webhook', () => {
  let app: INestApplication;
  let queue: InProcessTelegramUpdateQueue;
  let telegram: ReturnType<typeof slowTelegram>;
  const bots = {
    byKey: jest.fn(async (key: string) => (key === BOT_KEY ? BOT : null)),
  };
  const url = `/telegram/bot/${BOT_KEY}/webhook`;
  const post = (body: object, secret = SECRET) =>
    request(app.getHttpServer())
      .post(url)
      .set('X-Telegram-Bot-Api-Secret-Token', secret)
      .send(body);

  beforeEach(async () => {
    telegram = slowTelegram();
    const verification = new TelegramVerificationService(
      new FakeRedis() as any,
      { telegramVerifyTtlSeconds: 300, otpLength: 6 } as any,
      bots as any,
      {} as any,
      {} as any,
      { hit: async () => undefined } as any,
      telegram.client as any,
      { log: async () => undefined } as any,
      {} as any,
      { startUrl: async () => null } as any,
    );
    queue = new InProcessTelegramUpdateQueue((job) =>
      processTelegramUpdate({ bots, verification }, job),
    );
    app = await createHttpApp({
      controllers: [TelegramBotWebhookController],
      providers: [
        { provide: TelegramBotService, useValue: bots },
        { provide: TelegramVerificationService, useValue: verification },
        { provide: TELEGRAM_UPDATE_QUEUE, useValue: queue },
      ],
    });
  });

  afterEach(async () => {
    telegram.release();
    await queue.idle();
    await app.close();
  });

  it('answers 200 while Telegram is still sending the reply', async () => {
    await post(startUpdate(1)).expect(200, { ok: true });
    // The reply goes out after the response, and Telegram has not answered it yet
    await until(() => telegram.sendMessage.length === 1);
    expect(telegram.answered()).toBe(0);

    telegram.release();
    await queue.idle();
    expect(telegram.answered()).toBe(1);
  });

  it('handles a repeated update_id exactly once, also when deliveries overlap', async () => {
    const [a, b] = await Promise.all([
      post(startUpdate(7)),
      post(startUpdate(7)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await post(startUpdate(7)).expect(200);
    telegram.release();
    await queue.idle();

    expect(queue.jobs).toHaveLength(1);
    expect(telegram.sendMessage).toHaveLength(1);
  });

  it('queues the bot key and the update, never the token', async () => {
    await post(startUpdate(2)).expect(200);
    expect(queue.jobs).toEqual([{ botKey: BOT_KEY, update: startUpdate(2) }]);
    expect(JSON.stringify(queue.jobs)).not.toContain(TOKEN);
  });

  it.each([
    ['a wrong secret', 'e'.repeat(64)],
    ['the stored hash as the secret', hashWebhookSecret(SECRET)],
    ['an empty secret', ''],
  ])('refuses %s with 401 and queues nothing', async (_why, secret) => {
    await post(startUpdate(3), secret).expect(401);
    expect(queue.jobs).toHaveLength(0);
  });

  it('503 platform_misconfigured when the bot token cannot be decrypted (W9-05)', async () => {
    bots.byKey.mockRejectedValueOnce(
      platformMisconfigured('telegram_bot', 'bot token cannot be decrypted'),
    );
    const res = await post(startUpdate(6)).expect(503);
    expect(res.body).toMatchObject({
      code: 'platform_misconfigured',
      details: { feature: 'telegram_bot' },
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('decrypted');
  });

  it('404s an unknown bot', async () => {
    await request(app.getHttpServer())
      .post('/telegram/bot/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send(startUpdate(4))
      .expect(404);
  });

  it('answers 503 when the update cannot be queued, and accepts Telegram retrying it', async () => {
    queue.fail = new Error('redis down');
    await post(startUpdate(5)).expect(503);
    expect(queue.jobs).toHaveLength(0);

    queue.fail = null;
    await post(startUpdate(5)).expect(200);
    expect(queue.jobs).toHaveLength(1);
  });
});
