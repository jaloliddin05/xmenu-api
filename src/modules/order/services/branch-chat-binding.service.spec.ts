import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import { TelegramOrdersController } from '../controllers/telegram-orders.controller';
import {
  BIND_CODE_TTL_SECONDS,
  BranchChatBindingService,
  newBindCode,
  parseBindCommand,
} from './branch-chat-binding.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const CHAT = '-1001000000001';

class FakeBranches {
  rows = [
    {
      id: 'b1',
      organization_id: ORG,
      title: 'Чиланзар <1>',
      telegram_chat_id: null as string | null,
    },
    {
      id: 'b2',
      organization_id: ORG,
      title: 'Юнусабад',
      telegram_chat_id: null as string | null,
    },
    {
      id: 'b3',
      organization_id: OTHER_ORG,
      title: 'Чужой',
      telegram_chat_id: null as string | null,
    },
  ];
  branch = {
    findFirst: async ({
      where,
    }: {
      where: { id: string; organization_id: string };
    }) =>
      this.rows.find(
        (r) => r.id === where.id && r.organization_id === where.organization_id,
      ) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.rows.find((r) => r.id === where.id) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { telegram_chat_id: string | null };
    }) => {
      const row = this.rows.find((r) => r.id === where.id)!;
      row.telegram_chat_id = data.telegram_chat_id;
      return row;
    },
  };
  chat(id: string) {
    return this.rows.find((r) => r.id === id)!.telegram_chat_id;
  }
}

function setup() {
  const redis = new FakeRedis();
  const db = new FakeBranches();
  const telegram = {
    sent: [] as { chatId: string | number; text: string }[],
    getMe: jest.fn(async () => ({ id: 1, username: 'xmenu_orders_bot' })),
    sendMessage: jest.fn(async (chatId: string | number, text: string) => {
      telegram.sent.push({ chatId, text });
      return null;
    }),
  };
  const binding = new BranchChatBindingService(
    db as any,
    new RateLimitService(redis as unknown as Redis),
    telegram as any,
    redis as unknown as Redis,
  );
  return { redis, db, telegram, binding };
}

describe('BranchChatBindingService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('codes are 8 characters without look-alike ones', () => {
    for (let i = 0; i < 200; i++)
      expect(newBindCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('a code binds the chat to its branch once; Redis keeps only its hash', async () => {
    const { redis, db, binding } = setup();
    const res = await binding.createCode(ORG, 'b1');
    expect(res).toEqual({
      code: expect.stringMatching(/^[A-Z2-9]{8}$/),
      expiresIn: BIND_CODE_TTL_SECONDS,
      botUsername: 'xmenu_orders_bot',
    });
    expect(JSON.stringify([...(redis as any).data.entries()])).not.toContain(
      res.code,
    );

    expect(await binding.bind(CHAT, res.code)).toEqual({
      status: 'bound',
      branchTitle: 'Чиланзар <1>',
    });
    expect(db.chat('b1')).toBe(CHAT);
    expect(await binding.bind('-1009', res.code)).toEqual({
      status: 'invalid',
    });
    expect(db.chat('b1')).toBe(CHAT);
  });

  it('a new code cancels the previous one of the same branch, not of another', async () => {
    const { db, binding } = setup();
    const first = await binding.createCode(ORG, 'b1');
    const other = await binding.createCode(ORG, 'b2');
    const second = await binding.createCode(ORG, 'b1');
    expect(await binding.bind(CHAT, first.code)).toEqual({ status: 'invalid' });
    expect((await binding.bind(CHAT, second.code)).status).toBe('bound');
    expect((await binding.bind('-1002', other.code)).status).toBe('bound');
    expect([db.chat('b1'), db.chat('b2')]).toEqual([CHAT, '-1002']);
  });

  it('a code expires after 10 minutes', async () => {
    const { redis, db, binding } = setup();
    const { code } = await binding.createCode(ORG, 'b1');
    redis.advance(BIND_CODE_TTL_SECONDS + 1);
    expect(await binding.bind(CHAT, code)).toEqual({ status: 'invalid' });
    expect(db.chat('b1')).toBeNull();
  });

  it('another venue’s branch: 404, no code', async () => {
    const { binding } = setup();
    await expect(binding.createCode(ORG, 'b3')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(binding.unbind(ORG, 'b3')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('5 attempts per chat in 10 minutes, then rate_limited even with the right code', async () => {
    const { redis, binding } = setup();
    for (let i = 0; i < 5; i++)
      expect(await binding.bind(CHAT, 'WRONG234')).toEqual({
        status: 'invalid',
      });
    const { code } = await binding.createCode(ORG, 'b1');
    expect(await binding.bind(CHAT, code)).toEqual({ status: 'rate_limited' });
    expect((await binding.bind('-1003', code)).status).toBe('bound');
    redis.advance(601);
    expect(await binding.bind(CHAT, 'WRONG234')).toEqual({ status: 'invalid' });
  });

  it('unbind clears the chat of the branch', async () => {
    const { db, binding } = setup();
    const { code } = await binding.createCode(ORG, 'b1');
    await binding.bind(CHAT, code);
    await binding.unbind(ORG, 'b1');
    expect(db.chat('b1')).toBeNull();
  });

  it('parses /bind with and without the bot name', () => {
    expect(parseBindCommand('/bind k7qw2m9p')).toBe('K7QW2M9P');
    expect(parseBindCommand('/bind@xmenu_orders_bot K7QW2M9P ')).toBe(
      'K7QW2M9P',
    );
    expect(parseBindCommand('/bind')).toBeNull();
    expect(parseBindCommand('/binder X')).toBeUndefined();
    expect(parseBindCommand('hello')).toBeUndefined();
    expect(parseBindCommand(undefined)).toBeUndefined();
  });
});

describe('platform bot webhook: /bind', () => {
  const SECRET = 'webhook-secret';
  const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = saved;
    jest.restoreAllMocks();
  });

  const controllerFor = (s: ReturnType<typeof setup>) =>
    new TelegramOrdersController(
      {} as any,
      {} as any,
      s.telegram as any,
      {} as any,
      s.binding,
    );
  const message = (text: string, type = 'supergroup', id = Number(CHAT)) => ({
    message: { chat: { id, type }, text },
  });

  it('binds from a group and answers there, with the branch title escaped', async () => {
    const s = setup();
    const { code } = await s.binding.createCode(ORG, 'b1');
    await controllerFor(s).webhook(SECRET, message(`/bind ${code}`));
    expect(s.db.chat('b1')).toBe(CHAT);
    expect(s.telegram.sent).toEqual([
      {
        chatId: Number(CHAT),
        text: expect.stringContaining('«Чиланзар &lt;1&gt;»'),
      },
    ]);
  });

  it('a wrong code gets a short answer; a private chat cannot be bound', async () => {
    const s = setup();
    const { code } = await s.binding.createCode(ORG, 'b1');
    const c = controllerFor(s);
    await c.webhook(SECRET, message('/bind AAAAAAAA'));
    await c.webhook(SECRET, message(`/bind ${code}`, 'private', 42));
    expect(s.db.chat('b1')).toBeNull();
    expect(s.telegram.sent.map((m) => m.text)).toEqual([
      'Код неверный или устарел. Получите новый код в дашборде.',
      expect.stringContaining('только группу'),
    ]);
  });

  it('other messages are ignored; a wrong secret is refused', async () => {
    const s = setup();
    const c = controllerFor(s);
    await c.webhook(SECRET, message('привет'));
    expect(s.telegram.sent).toEqual([]);
    await expect(
      c.webhook('wrong-secret!!', message('/bind AAAAAAAA')),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
