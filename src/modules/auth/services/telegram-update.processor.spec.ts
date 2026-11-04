import {
  describeTelegramUpdate,
  processTelegramUpdate,
} from './telegram-update.processor';
import { telegramUpdateJobId } from './telegram-update.queue';

const BOT = {
  botKey: 'bot-1',
  organizationId: 'tenant-1',
  username: 'mant_bot',
  token: '111111:TOKEN',
  webhookSecretHash: 'h',
};
const UPDATE = {
  update_id: 42,
  message: { contact: { phone_number: '+998901234567', user_id: 5 } },
};

function deps(bot: typeof BOT | null = BOT) {
  return {
    bots: { byKey: jest.fn(async () => bot) },
    verification: { handleUpdate: jest.fn(async () => undefined) },
  };
}

describe('processTelegramUpdate', () => {
  it('hands the update to the verification flow with the freshly loaded bot', async () => {
    const d = deps();
    await expect(
      processTelegramUpdate(d as any, { botKey: 'bot-1', update: UPDATE }),
    ).resolves.toBe('done');
    expect(d.bots.byKey).toHaveBeenCalledWith('bot-1');
    expect(d.verification.handleUpdate).toHaveBeenCalledWith(BOT, UPDATE);
  });

  it('skips an update of a bot disconnected since the webhook call', async () => {
    const d = deps(null);
    await expect(
      processTelegramUpdate(d as any, { botKey: 'bot-1', update: UPDATE }),
    ).resolves.toBe('skipped');
    expect(d.verification.handleUpdate).not.toHaveBeenCalled();
  });

  it('lets a failure through so the queue retries', async () => {
    const d = deps();
    d.verification.handleUpdate.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      processTelegramUpdate(d as any, { botKey: 'bot-1', update: UPDATE }),
    ).rejects.toThrow('redis down');
  });
});

describe('telegram-update job', () => {
  it('logs ids only: no phone from the update, no token', () => {
    const text = describeTelegramUpdate({ botKey: 'bot-1', update: UPDATE });
    expect(text).toBe('bot bot-1 update 42');
    expect(describeTelegramUpdate(undefined)).toBe('bot ? update ?');
  });

  it('gets one job id per delivered update, none without an update_id', () => {
    expect(telegramUpdateJobId({ botKey: 'bot-1', update: UPDATE })).toBe(
      'tg-update-bot-1-42',
    );
    expect(telegramUpdateJobId({ botKey: 'bot-1', update: {} })).toBe(
      undefined,
    );
  });
});
