// otp-bot.ts builds its TelegramBot client once at module-load time (not
// through Nest DI), so the only way to test it without a real network call
// is to mock the module *before* importing otp-bot. Each test gets a fresh
// module registry (jest.resetModules + dynamic import) so the mocked
// constructor is captured per-test rather than shared/stale across them.

type SendMessageArgs = [chatId: string, message: string, options?: unknown];

describe('sendCustomerOtpSms', () => {
  const OTP_BOT = 'test-bot-token';
  const XMENU_CHAT_ID = '-100123456789';

  beforeEach(() => {
    jest.resetModules();
    process.env.OTP_BOT = OTP_BOT;
    process.env.XMENU_CHAT_ID = XMENU_CHAT_ID;
  });

  function loadWithMockedBot() {
    const sendMessage = jest
      .fn<Promise<void>, SendMessageArgs>()
      .mockResolvedValue(undefined);
    jest.doMock('node-telegram-bot-api', () =>
      jest.fn().mockImplementation(() => ({ sendMessage })),
    );

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

    expect(sendMessage).toHaveBeenCalledTimes(1);
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
});
