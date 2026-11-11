import { Logger } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { TelegramApiError } from './telegram-client';
import { TelegramBotProfileService } from './telegram-bot-profile.service';

const ORG = 'org-1';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

function setup(
  opts: {
    languages?: string[];
    slug?: string | null;
    connected?: boolean;
    mode?: 'site' | 'miniapp' | 'both';
    primaryDomain?: string;
  } = {},
) {
  const languages = opts.languages ?? ['ru', 'uz'];
  // Mutable so a test can change the mode or the primary domain between calls
  const venue = {
    delivery_mode: opts.mode ?? 'miniapp',
    domains: opts.primaryDomain ? [{ host: opts.primaryDomain }] : [],
  };
  let row: any = {
    organization_id: ORG,
    profile: null,
    synced_at: null,
    sync_result: null,
  };
  const prisma = {
    organization: {
      findUnique: jest.fn(async ({ select }: any) =>
        select.slug && !select.name
          ? { slug: opts.slug === undefined ? 'mant' : opts.slug, ...venue }
          : {
              ...venue,
              name: 'Mant',
              slug: opts.slug === undefined ? 'mant' : opts.slug,
              translations: [{ lang: 'ru', description: 'Лучший плов' }],
              settings: { languages, default_language: languages[0] },
            },
      ),
    },
    organization_telegram_bot: {
      findUnique: jest.fn(async () => (opts.connected === false ? null : row)),
      update: jest.fn(async ({ data }: any) => (row = { ...row, ...data })),
    },
  };
  const client = {
    call: jest.fn<Promise<unknown>, [string, string, any?]>(async () => true),
  };
  const bots = {
    forTenant: jest.fn(async () =>
      opts.connected === false ? null : { token: TOKEN, organizationId: ORG },
    ),
    status: jest.fn(async () =>
      opts.connected === false
        ? {
            connected: false,
            username: null,
            link: null,
            isEnabled: false,
          }
        : {
            connected: true,
            username: 'mant_bot',
            link: 'https://t.me/mant_bot',
            isEnabled: true,
          },
    ),
  };
  const svc = new TelegramBotProfileService(
    prisma as any,
    client as any,
    bots as any,
  );
  const calls = (method: string) =>
    client.call.mock.calls.filter((c) => c[1] === method).map((c) => c[2]);
  return { svc, prisma, client, bots, calls, venue, row: () => row };
}

describe('TelegramBotProfileService', () => {
  const OLD = process.env.DELIVERY_URL_TEMPLATE;
  beforeEach(() => {
    process.env.DELIVERY_URL_TEMPLATE = 'https://{slug}.xmenu.uz';
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.DELIVERY_URL_TEMPLATE;
    else process.env.DELIVERY_URL_TEMPLATE = OLD;
  });

  it('pushes name, descriptions and /start per language plus the default, and the menu button', async () => {
    const { svc, calls, row } = setup();
    const result = await svc.apply(ORG);

    expect(result).toEqual({
      name: { status: 'ok' },
      description: { status: 'ok' },
      shortDescription: { status: 'ok' },
      commands: { status: 'ok' },
      menuButton: { status: 'ok' },
    });
    // default (no language_code) + ru + uz
    expect(calls('setMyName')).toEqual(
      expect.arrayContaining([
        { name: 'Mant' },
        { name: 'Mant', language_code: 'ru' },
        { name: 'Mant', language_code: 'uz' },
      ]),
    );
    expect(calls('setMyName')).toHaveLength(3);
    expect(calls('setMyDescription')).toContainEqual({
      description: 'Лучший плов',
      language_code: 'ru',
    });
    expect(calls('setMyCommands')).toContainEqual({
      commands: [{ command: 'start', description: 'Menyuni ochish' }],
      language_code: 'uz',
    });
    expect(calls('setChatMenuButton')).toEqual([
      {
        menu_button: {
          type: 'web_app',
          text: 'Меню',
          web_app: { url: 'https://mant.xmenu.uz' },
        },
      },
    ]);
    expect(row().sync_result).toEqual(result);
    expect(row().synced_at).toBeInstanceOf(Date);
  });

  it('a failing item does not stop the others and is reported with a code, Telegram text only in the log', async () => {
    const { svc, client, row } = setup();
    client.call.mockImplementation(async (_t, method, payload) => {
      if (method === 'setMyName' && payload?.language_code === 'uz') {
        throw new TelegramApiError(
          method,
          'Too Many Requests: retry after 3600',
          429,
        );
      }
      return true;
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const result = await svc.apply(ORG);

    expect(result.name).toEqual({
      status: 'failed',
      code: 'telegram_request_failed',
    });
    expect(JSON.stringify(row().sync_result)).not.toContain('Too Many');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Too Many Requests'),
    );
    warn.mockRestore();
    expect(result.description.status).toBe('ok');
    expect(result.menuButton.status).toBe('ok');
    expect(JSON.stringify(row().sync_result)).not.toContain(TOKEN);
  });

  it('skips the menu button without DELIVERY_URL_TEMPLATE but applies the rest', async () => {
    delete process.env.DELIVERY_URL_TEMPLATE;
    const { svc, calls } = setup();
    const result = await svc.apply(ORG);
    expect(result.menuButton).toEqual({
      status: 'skipped',
      code: 'platform_misconfigured',
      feature: 'delivery_link',
    });
    expect(result.name.status).toBe('ok');
    expect(calls('setChatMenuButton')).toHaveLength(0);
  });

  it('apply without a connected bot: bot_not_connected', async () => {
    const { svc } = setup({ connected: false });
    await expect(svc.apply(ORG)).rejects.toMatchObject({
      code: 'bot_not_connected',
    });
  });

  it('view: defaults until saved, then the saved profile with isDefault false', async () => {
    const { svc } = setup();
    const first = await svc.view(ORG);
    expect(first.isDefault).toBe(true);
    expect(first.profile.ru.name).toBe('Mant');
    expect(first.deliveryUrl).toBe('https://mant.xmenu.uz');
    expect(first.lastSync).toBeNull();

    await svc.save(ORG, {
      ru: {
        name: 'Mant Plov',
        description: '',
        shortDescription: 'Plov',
        menuButtonText: 'Menu',
      },
    });
    const second = await svc.view(ORG);
    expect(second.isDefault).toBe(false);
    expect(second.profile.ru.name).toBe('Mant Plov');
    expect(second.profile.uz.name).toBe('Mant'); // not sent: keeps its default
    expect(second.lastSync?.result.name.status).toBe('ok');
  });

  it('save rejects bad input with field errors and stores nothing', async () => {
    const { svc, prisma, client } = setup();
    const err: AppException = await svc
      .save(ORG, {
        ru: {
          name: '',
          description: '',
          shortDescription: 'x',
          menuButtonText: 'm',
        },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.fields?.[0]).toMatchObject({
      field: 'ru.name',
      code: 'is_not_empty',
    });
    expect(prisma.organization_telegram_bot.update).not.toHaveBeenCalled();
    expect(client.call).not.toHaveBeenCalled();
  });

  it('save for a language the venue has not enabled is refused', async () => {
    const { svc } = setup({ languages: ['ru'] });
    const err = await svc
      .save(ORG, {
        uz: {
          name: 'x',
          description: '',
          shortDescription: 'x',
          menuButtonText: 'x',
        },
      })
      .catch((e) => e);
    expect(err.getResponse().fields[0]).toMatchObject({
      field: 'uz',
      code: 'not_in_languages',
    });
  });

  it('syncMenuButton updates only the button and keeps the other sync results; never throws', async () => {
    const { svc, calls, row, client } = setup();
    await svc.apply(ORG);
    client.call.mockClear();

    await svc.syncMenuButton(ORG);
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(calls('setChatMenuButton')).toHaveLength(1);
    expect(row().sync_result.name).toEqual({ status: 'ok' });

    client.call.mockRejectedValue(
      new TelegramApiError('setChatMenuButton', 'boom'),
    );
    await expect(svc.syncMenuButton(ORG)).resolves.toBeUndefined();
  });

  describe('the menu button follows the delivery mode and the primary domain', () => {
    it.each(['miniapp', 'both'] as const)(
      '%s: web_app button to the platform address',
      async (mode) => {
        const { svc, calls } = setup({ mode });
        await svc.syncMenuButton(ORG);
        expect(calls('setChatMenuButton')).toEqual([
          {
            menu_button: {
              type: 'web_app',
              text: 'Меню',
              web_app: { url: 'https://mant.xmenu.uz' },
            },
          },
        ]);
      },
    );

    it('a primary own domain wins over the platform address, also without a template', async () => {
      delete process.env.DELIVERY_URL_TEMPLATE;
      const { svc, calls } = setup({ primaryDomain: 'mant.uz' });
      await svc.syncMenuButton(ORG);
      expect(calls('setChatMenuButton')[0].menu_button.web_app).toEqual({
        url: 'https://mant.uz',
      });
      await expect(svc.startUrl(ORG)).resolves.toBe('https://mant.uz');
    });

    it('site: Telegram default button, reported ok; /start has no Mini App button', async () => {
      const { svc, calls, row } = setup({ mode: 'site' });
      await svc.apply(ORG);
      expect(calls('setChatMenuButton')).toEqual([
        { menu_button: { type: 'default' } },
      ]);
      expect(row().sync_result.menuButton).toEqual({ status: 'ok' });
      await expect(svc.startUrl(ORG)).resolves.toBeNull();
      expect((await svc.view(ORG)).deliveryUrl).toBeNull();
    });

    it('is idempotent: every sync sends the whole wanted state again', async () => {
      const { svc, calls, venue } = setup();
      await svc.syncMenuButton(ORG);
      await svc.syncMenuButton(ORG);
      venue.delivery_mode = 'site';
      await svc.syncMenuButton(ORG);
      const sent = calls('setChatMenuButton');
      expect(sent[0]).toEqual(sent[1]);
      expect(sent[2]).toEqual({ menu_button: { type: 'default' } });
    });

    it('a Telegram failure on the default button is logged and recorded as telegram_request_failed', async () => {
      const { svc, client, row } = setup({ mode: 'site' });
      await svc.apply(ORG);
      client.call.mockRejectedValue(
        new TelegramApiError('setChatMenuButton', 'boom'),
      );
      await expect(svc.syncMenuButton(ORG)).resolves.toBeUndefined();
      expect(row().sync_result.menuButton).toEqual({
        status: 'failed',
        code: 'telegram_request_failed',
      });
    });
  });

  it('startUrl: the venue Mini App address, null without a template or on errors', async () => {
    const { svc, prisma } = setup();
    await expect(svc.startUrl(ORG)).resolves.toBe('https://mant.xmenu.uz');
    prisma.organization.findUnique.mockRejectedValueOnce(new Error('db'));
    await expect(svc.startUrl(ORG)).resolves.toBeNull();
  });

  it('fullStatus without a bot has an empty profile part', async () => {
    const { svc } = setup({ connected: false });
    await expect(svc.fullStatus(ORG)).resolves.toMatchObject({
      connected: false,
      profile: null,
      deliveryUrl: null,
      lastSync: null,
    });
  });
});
