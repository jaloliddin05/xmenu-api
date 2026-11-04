import axios from 'axios';
import { TelegramApiError, TelegramClient } from './telegram-client';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: () => false },
}));

const post = axios.post as jest.Mock;

describe('TelegramClient', () => {
  const OLD = process.env.TELEGRAM_API_BASE_URL;
  afterEach(() => {
    post.mockReset();
    if (OLD === undefined) delete process.env.TELEGRAM_API_BASE_URL;
    else process.env.TELEGRAM_API_BASE_URL = OLD;
  });

  it('calls the real Telegram by default', async () => {
    delete process.env.TELEGRAM_API_BASE_URL;
    post.mockResolvedValue({ data: { ok: true, result: { id: 1 } } });
    await expect(new TelegramClient().call('1:T', 'getMe')).resolves.toEqual({
      id: 1,
    });
    expect(post.mock.calls[0][0]).toBe('https://api.telegram.org/bot1:T/getMe');
  });

  it('calls TELEGRAM_API_BASE_URL when it is set', async () => {
    process.env.TELEGRAM_API_BASE_URL = 'http://127.0.0.1:4604/';
    post.mockResolvedValue({ data: { ok: true, result: true } });
    await new TelegramClient().call('1:T', 'deleteWebhook');
    expect(post.mock.calls[0][0]).toBe(
      'http://127.0.0.1:4604/bot1:T/deleteWebhook',
    );
  });

  it('turns a failure into an error without the token', async () => {
    post.mockRejectedValue(new Error('connect ETIMEDOUT .../bot1:T/getMe'));
    const err: unknown = await new TelegramClient()
      .call('1:T', 'getMe')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect(String((err as Error).message)).not.toContain('1:T');
  });
});
