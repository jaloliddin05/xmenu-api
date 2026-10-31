// otp-bot.ts reads its token and chat id once at module-load time (not
// through Nest DI), so the only way to test it without a real network call
// is to mock axios *before* importing otp-bot. Each test gets a fresh
// module registry (jest.resetModules + require) so the env is picked up
// per-test rather than shared/stale across them.

type PostArgs = [url: string, body: Record<string, unknown>, config?: unknown];

describe('sendCustomerOtpSms', () => {
  const OTP_BOT = 'test-bot-token';
  const XMENU_CHAT_ID = '-100123456789';

  beforeEach(() => {
    jest.resetModules();
    process.env.OTP_BOT = OTP_BOT;
    process.env.XMENU_CHAT_ID = XMENU_CHAT_ID;
  });

  function loadWithMockedBot() {
    const post = jest.fn<Promise<unknown>, PostArgs>().mockResolvedValue({});
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { post, isAxiosError: () => false },
    }));
    // Same shape as the old bot mock: (chatId, text, extra body fields).
    const sendMessage = {
      get mock() {
        return {
          calls: post.mock.calls.map(([, body]) => {
            const { chat_id, text, ...options } = body;
            return [
              chat_id as string,
              text as string,
              Object.keys(options).length ? options : undefined,
            ] as [string, string, unknown];
          }),
        };
      },
      get post() {
        return post;
      },
    };

    // This project's Jest runs ts-jest under plain CommonJS (no
    // --experimental-vm-modules), so `await import()` doesn't pick up
    // jest.doMock's fresh registry — only CJS require() does. That's the
    // deliberate, well-known way to isolate modules per-test in Jest+CJS;
    // see https://jestjs.io/docs/jest-object#jestresetmodules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const otpBot = require('./otp-bot') as typeof import('./otp-bot');
    return { otpBot, sendMessage };
  }

  it('sends to the configured chat id, with the phone and the rendered SMS text', async () => {
    const { otpBot, sendMessage } = loadWithMockedBot();
    const text = 'Код для входа в Mant: 1234. Никому не сообщайте.';

    await otpBot.sendCustomerOtpSms('+998901234567', text);

    expect(sendMessage.post).toHaveBeenCalledTimes(1);
    expect(sendMessage.post.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${OTP_BOT}/sendMessage`,
    );
    const [chatId, message, options] = sendMessage.mock.calls[0];
    expect(chatId).toBe(XMENU_CHAT_ID);
    expect(message).toContain('+998901234567');
    expect(message).toContain(text);
    // No parse_mode: the message embeds a tenant-controlled brand name
    // (inside `text`), and Telegram's Markdown parser throws on unescaped
    // *, _, ` — which would turn an unusual restaurant name into a hard
    // failure on every otp/request for that tenant. Plain text sidesteps
    // that entirely; see the comment on sendCustomerOtpSms.
    expect(options).toBeUndefined();
  });

  it('visibly marks the message as a test/relay, not a real staff notification', async () => {
    const { otpBot, sendMessage } = loadWithMockedBot();

    await otpBot.sendCustomerOtpSms('+998901234567', 'any text');

    const [, message] = sendMessage.mock.calls[0];
    expect(message).toMatch(/^🧪 Test SMS/);
  });

  it('does not choke on Markdown special characters in the brand name (no parse_mode = no parser to reject them)', async () => {
    const { otpBot, sendMessage } = loadWithMockedBot();
    const text =
      'Код для входа в Burger*King_Tashkent `99`: 1234. Никому не сообщайте.';

    await expect(
      otpBot.sendCustomerOtpSms('+998901234567', text),
    ).resolves.toBeUndefined();

    const [, message] = sendMessage.mock.calls[0];
    expect(message).toContain(text);
  });

  it('rejects without leaking the bot token when Telegram is unreachable', async () => {
    const { otpBot, sendMessage } = loadWithMockedBot();
    sendMessage.post.mockRejectedValueOnce(
      new Error(`connect ETIMEDOUT https://api.telegram.org/bot${OTP_BOT}/sendMessage`),
    );

    const result = otpBot.sendCustomerOtpSms('+998901234567', 'any text');

    await expect(result).rejects.toThrow('Telegram sendMessage failed');
    await expect(result).rejects.not.toThrow(OTP_BOT);
  });
});
