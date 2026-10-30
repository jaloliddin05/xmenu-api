import { CustomerAuthException } from '../errors/customer-auth.exception';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { TelegramVerificationService } from './telegram-verification.service';
import type { TelegramUpdate } from './telegram-verification.service';

const TENANT = { id: 'tenant-1', brandName: 'Mant' } as any;
const OTHER_TENANT = { id: 'tenant-2', brandName: 'Other' } as any;
const BOT = {
  botKey: 'bot-1',
  organizationId: 'tenant-1',
  username: 'mant_bot',
  token: '111111:TOKEN',
  webhookSecret: 's',
};
const CTX = { ip: '1.2.3.4', userAgent: 'jest' };
const PHONE = '+998901234567';
const USER_ID = 555;

function setup(opts: { bot?: typeof BOT | null; devMode?: boolean } = {}) {
  const redis = new FakeRedis();
  const sent: any[] = [];
  const client = {
    call: jest.fn(async (_token: string, method: string, payload: any) => {
      if (method === 'sendMessage') sent.push(payload);
      return {};
    }),
  };
  const bots = {
    forTenant: jest.fn(async () => (opts.bot === undefined ? BOT : opts.bot)),
  };
  const initData = { verifyWithToken: jest.fn(() => ({ id: USER_ID })) };
  const otp = {
    issue: jest.fn(async (_t: any, _p: string, o: any) => {
      await o.deliver('123456');
      return 60;
    }),
  };
  const rateLimit = { hit: jest.fn(async () => undefined) };
  const events = { log: jest.fn(async () => undefined) };
  const auth = {
    completeVerifiedPhone: jest.fn(async () => ({
      isNewUser: true,
      registrationToken: 'reg-token',
    })),
  };
  const botProfile = {
    startUrl: jest.fn(async (): Promise<string | null> => null),
  };
  const svc = new TelegramVerificationService(
    redis as any,
    { telegramVerifyTtlSeconds: 300 } as any,
    bots as any,
    initData as any,
    otp as any,
    rateLimit as any,
    client as any,
    events as any,
    auth as any,
    botProfile as any,
  );
  let updateId = 1;
  const update = (message: any): TelegramUpdate => ({
    update_id: updateId++,
    message,
  });
  const priv = (extra: any) => ({
    chat: { id: USER_ID, type: 'private' },
    from: { id: USER_ID, language_code: 'ru' },
    ...extra,
  });
  return {
    svc,
    redis,
    sent,
    client,
    bots,
    initData,
    otp,
    rateLimit,
    events,
    auth,
    botProfile,
    update,
    priv,
  };
}

describe('TelegramVerificationService.start', () => {
  it('requires a connected tenant bot', async () => {
    const { svc } = setup({ bot: null });
    await expect(
      svc.start(TENANT, { phone: PHONE }, CTX),
    ).rejects.toMatchObject({ code: 'telegram_unavailable' });
  });

  it('website mode needs a valid phone', async () => {
    const { svc } = setup();
    await expect(svc.start(TENANT, {}, CTX)).rejects.toBeInstanceOf(
      CustomerAuthException,
    );
    await expect(
      svc.start(TENANT, { phone: '12345' }, CTX),
    ).rejects.toMatchObject({ code: 'invalid_phone' });
  });

  it('website mode returns a deep link carrying the session id', async () => {
    const { svc, redis } = setup();
    const r = await svc.start(TENANT, { phone: PHONE }, CTX);
    expect(r.mode).toBe('code');
    expect(r.deepLink).toBe(`https://t.me/mant_bot?start=${r.sessionId}`);
    expect(r.sessionId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(r.expiresIn).toBe(300);
    expect(await redis.hgetall(`tgv:s:${r.sessionId}`)).toMatchObject({
      mode: 'code',
      phoneExpected: PHONE,
      status: 'pending',
    });
  });

  it('Mini App mode binds the session to the Telegram user from signed initData', async () => {
    const { svc, redis, initData } = setup();
    const r = await svc.start(TENANT, { initData: 'signed' }, CTX);
    expect(initData.verifyWithToken).toHaveBeenCalledWith('signed', BOT.token);
    expect(r.mode).toBe('instant');
    expect(await redis.get(`tgv:u:bot-1:${USER_ID}`)).toBe(r.sessionId);
  });

  it('rejects invalid initData before creating anything', async () => {
    const { svc, initData, redis } = setup();
    initData.verifyWithToken.mockImplementation(() => {
      throw new CustomerAuthException('invalid_telegram_data');
    });
    await expect(
      svc.start(TENANT, { initData: 'forged' }, CTX),
    ).rejects.toMatchObject({ code: 'invalid_telegram_data' });
    expect(await redis.get(`tgv:u:bot-1:${USER_ID}`)).toBeNull();
  });
});

describe('website ("code") mode through the bot', () => {
  async function started() {
    const ctx = setup();
    const r = await ctx.svc.start(TENANT, { phone: PHONE }, CTX);
    return { ...ctx, sid: r.sessionId };
  }

  it('/start <sid> asks for the contact with a request_contact button', async () => {
    const { svc, update, priv, sent, sid } = await started();
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Mant');
    expect(sent[0].reply_markup.keyboard[0][0].request_contact).toBe(true);
  });

  it('/start without a session greets with a Mini App button when the venue address is known', async () => {
    const { svc, update, priv, sent, botProfile } = setup();
    botProfile.startUrl.mockResolvedValue('https://mant.xmenu.uz');
    await svc.handleUpdate(BOT, update(priv({ text: '/start' })));
    expect(botProfile.startUrl).toHaveBeenCalledWith('tenant-1');
    expect(sent[0].reply_markup.inline_keyboard[0][0]).toEqual({
      text: 'Открыть меню',
      web_app: { url: 'https://mant.xmenu.uz' },
    });
  });

  it('/start without a session and without an address only greets', async () => {
    const { svc, update, priv, sent } = setup();
    await svc.handleUpdate(BOT, update(priv({ text: '/start' })));
    expect(sent[0].reply_markup).toEqual({ remove_keyboard: true });
  });

  it('answers "expired" for an unknown or foreign-bot session', async () => {
    const { svc, update, priv, sent } = await started();
    await svc.handleUpdate(
      BOT,
      update(priv({ text: '/start ' + 'x'.repeat(32) })),
    );
    expect(sent[0].text).toContain('истекла');
    await svc.handleUpdate(
      { ...BOT, botKey: 'other-bot' },
      update(priv({ text: '/start whatever-whatever-whatever-1' })),
    );
    expect(sent[1].text).toContain('истекла');
  });

  it('delivers a code only when the shared contact matches the requested phone', async () => {
    const { svc, update, priv, sent, otp, redis, sid } = await started();
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    await svc.handleUpdate(
      BOT,
      update(
        priv({ contact: { phone_number: '998901234567', user_id: USER_ID } }),
      ),
    );

    expect(otp.issue).toHaveBeenCalledTimes(1);
    expect(otp.issue.mock.calls[0][1]).toBe(PHONE);
    expect(otp.issue.mock.calls[0][2]).toMatchObject({
      alwaysDeliver: true,
      unavailableCode: 'telegram_unavailable',
    });
    expect(sent[sent.length - 1].text).toContain('<b>123456</b>');
    expect((await redis.hgetall(`tgv:s:${sid}`)).status).toBe('code_sent');
  });

  it('refuses a contact with a different phone: no code is issued', async () => {
    const { svc, update, priv, sent, otp, sid } = await started();
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    await svc.handleUpdate(
      BOT,
      update(
        priv({ contact: { phone_number: '998909999999', user_id: USER_ID } }),
      ),
    );
    expect(otp.issue).not.toHaveBeenCalled();
    expect(sent[sent.length - 1].text).toContain('не совпадает');
  });

  it("refuses somebody else's contact (user_id differs from the sender)", async () => {
    const { svc, update, priv, sent, otp, sid } = await started();
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: 999 } })),
    );
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE } })),
    );
    expect(otp.issue).not.toHaveBeenCalled();
    expect(sent[sent.length - 1].text).toContain('собственный');
  });

  it('refuses non-Uzbek numbers', async () => {
    const { svc, update, priv, sent, otp } = setup();
    const r = await svc.start(TENANT, { phone: PHONE }, CTX);
    await svc.handleUpdate(
      BOT,
      update(priv({ text: `/start ${r.sessionId}` })),
    );
    await svc.handleUpdate(
      BOT,
      update(
        priv({ contact: { phone_number: '79001234567', user_id: USER_ID } }),
      ),
    );
    expect(otp.issue).not.toHaveBeenCalled();
    expect(sent[sent.length - 1].text).toContain('+998');
  });

  it('gives up after too many contact attempts', async () => {
    const { svc, update, priv, sent, otp, redis, sid } = await started();
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    for (let i = 0; i < 4; i++) {
      await svc.handleUpdate(
        BOT,
        update(
          priv({ contact: { phone_number: '998909999999', user_id: USER_ID } }),
        ),
      );
    }
    expect(otp.issue).not.toHaveBeenCalled();
    expect(sent[sent.length - 1].text).toContain('Слишком много');
    expect(await redis.hgetall(`tgv:s:${sid}`)).toEqual({});
  });

  it('reports a delivery failure to the user instead of crashing the webhook', async () => {
    const { svc, update, priv, sent, otp, sid } = await started();
    otp.issue.mockRejectedValueOnce(new CustomerAuthException('rate_limited'));
    await svc.handleUpdate(BOT, update(priv({ text: `/start ${sid}` })));
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: USER_ID } })),
    );
    expect(sent[sent.length - 1].text).toContain('Слишком много');
  });
});

describe('Mini App ("instant") mode through the bot', () => {
  async function started() {
    const ctx = setup();
    const r = await ctx.svc.start(TENANT, { initData: 'signed' }, CTX);
    return { ...ctx, sid: r.sessionId };
  }

  it('confirms the phone on contact share without issuing a code, and status hands out the login once', async () => {
    const { svc, update, priv, sent, otp, auth, redis, sid } = await started();
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: USER_ID } })),
    );

    expect(otp.issue).not.toHaveBeenCalled();
    expect(sent[sent.length - 1].text).toContain('подтверждён');
    expect(await svc.status(TENANT, sid, CTX)).toEqual({
      status: 'verified',
      isNewUser: true,
      registrationToken: 'reg-token',
    });
    expect(auth.completeVerifiedPhone).toHaveBeenCalledWith(
      TENANT,
      PHONE,
      CTX,
      { telegramId: String(USER_ID) },
    );
    // one-time: the session is gone afterwards
    expect(await svc.status(TENANT, sid, CTX)).toEqual({ status: 'expired' });
    expect(await redis.hgetall(`tgv:s:${sid}`)).toEqual({});
  });

  it('a link forwarded to another Telegram user cannot hijack the session', async () => {
    const { svc, update, sent, otp, sid } = await started();
    const victim = {
      chat: { id: 777, type: 'private' },
      from: { id: 777, language_code: 'ru' },
    };
    await svc.handleUpdate(BOT, update({ ...victim, text: `/start ${sid}` }));
    expect(sent[sent.length - 1].text).toContain('другого аккаунта');
    await svc.handleUpdate(
      BOT,
      update({
        ...victim,
        contact: { phone_number: '998907654321', user_id: 777 },
      }),
    );
    expect(sent[sent.length - 1].text).toContain('истекла'); // no session is mapped to the victim
    expect(otp.issue).not.toHaveBeenCalled();
    expect(await svc.status(TENANT, sid, CTX)).toEqual({ status: 'pending' });
  });

  it('a parallel poll cannot get a second login result', async () => {
    const { svc, update, priv, auth, sid } = await started();
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: USER_ID } })),
    );
    const [a, b] = await Promise.all([
      svc.status(TENANT, sid, CTX),
      svc.status(TENANT, sid, CTX),
    ]);
    expect([a.status, b.status].sort()).toEqual(['pending', 'verified']);
    expect(auth.completeVerifiedPhone).toHaveBeenCalledTimes(1);
  });

  it('releases the one-time guard when completing the login fails', async () => {
    const { svc, update, priv, auth, sid } = await started();
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: USER_ID } })),
    );
    auth.completeVerifiedPhone.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.status(TENANT, sid, CTX)).rejects.toThrow('db down');
    expect((await svc.status(TENANT, sid, CTX)).status).toBe('verified');
  });
});

describe('status and webhook hygiene', () => {
  it('does not reveal a session to another tenant', async () => {
    const { svc } = setup();
    const r = await svc.start(TENANT, { phone: PHONE }, CTX);
    expect(await svc.status(OTHER_TENANT, r.sessionId, CTX)).toEqual({
      status: 'expired',
    });
    expect(
      await svc.status(TENANT, 'not-a-session-id-not-a-session', CTX),
    ).toEqual({ status: 'expired' });
  });

  it('reports code_sent so the client can show the code field', async () => {
    const { svc, update, priv } = setup();
    const r = await svc.start(TENANT, { phone: PHONE }, CTX);
    await svc.handleUpdate(
      BOT,
      update(priv({ text: `/start ${r.sessionId}` })),
    );
    await svc.handleUpdate(
      BOT,
      update(priv({ contact: { phone_number: PHONE, user_id: USER_ID } })),
    );
    expect(await svc.status(TENANT, r.sessionId, CTX)).toEqual({
      status: 'code_sent',
      phone: PHONE,
    });
  });

  it('a session ends after TELEGRAM_VERIFY_TTL_SECONDS', async () => {
    const { svc, redis, update, priv, sent, otp } = setup();
    const r = await svc.start(TENANT, { phone: PHONE }, CTX);
    redis.advance(300);
    expect(await svc.status(TENANT, r.sessionId, CTX)).toEqual({
      status: 'expired',
    });
    await svc.handleUpdate(
      BOT,
      update(priv({ text: `/start ${r.sessionId}` })),
    );
    expect(sent[sent.length - 1].text).toContain('истекла');
    expect(otp.issue).not.toHaveBeenCalled();
  });

  it('processes each update_id once and ignores groups and bots', async () => {
    const { svc, sent, priv } = setup();
    const msg = priv({ text: '/start' });
    await svc.handleUpdate(BOT, { update_id: 10, message: msg });
    await svc.handleUpdate(BOT, { update_id: 10, message: msg });
    expect(sent).toHaveLength(1);
    await svc.handleUpdate(BOT, {
      update_id: 11,
      message: { ...msg, chat: { id: 1, type: 'group' } },
    });
    await svc.handleUpdate(BOT, {
      update_id: 12,
      message: { ...msg, from: { id: 5, is_bot: true } },
    });
    await svc.handleUpdate(BOT, { update_id: 13 });
    expect(sent).toHaveLength(1);
  });
});
