import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TelegramApiError } from './telegram-client';
import { TelegramBotProfileService } from './telegram-bot-profile.service';

const ORG = 'org-1';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

function setup(
  opts: {
    languages?: string[];
    slug?: string | null;
    connected?: boolean;
  } = {},
) {
  const languages = opts.languages ?? ['ru', 'uz'];
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
          ? { slug: opts.slug === undefined ? 'mant' : opts.slug }
          : {
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
            webhookUrl: null,
            isEnabled: false,
          }
        : {
            connected: true,
            username: 'mant_bot',
            link: 'https://t.me/mant_bot',
            webhookUrl: 'w',
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
  return { svc, prisma, client, bots, calls, row: () => row };
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

  it('a failing item does not stop the others and is reported with Telegram text', async () => {
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
    const result = await svc.apply(ORG);

    expect(result.name).toEqual({
      status: 'failed',
      reason: 'uz: Too Many Requests: retry after 3600',
    });
    expect(result.description.status).toBe('ok');
    expect(result.menuButton.status).toBe('ok');
    expect(JSON.stringify(row().sync_result)).not.toContain(TOKEN);
  });

  it('skips the menu button without DELIVERY_URL_TEMPLATE but applies the rest', async () => {
    delete process.env.DELIVERY_URL_TEMPLATE;
    const { svc, calls } = setup();
    const result = await svc.apply(ORG);
    expect(result.menuButton).toEqual({ status: 'skipped_no_url' });
    expect(result.name.status).toBe('ok');
    expect(calls('setChatMenuButton')).toHaveLength(0);
  });

  it('apply without a connected bot: bot_not_connected', async () => {
    const { svc } = setup({ connected: false });
    await expect(svc.apply(ORG)).rejects.toBeInstanceOf(NotFoundException);
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
    const err: BadRequestException = await svc
      .save(ORG, {
        ru: {
          name: '',
          description: '',
          shortDescription: 'x',
          menuButtonText: 'm',
        },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err.getResponse() as any).errors[0]).toMatchObject({
      field: 'ru.name',
      reason: 'isNotEmpty',
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
    expect(err.getResponse().errors[0]).toMatchObject({
      field: 'uz',
      reason: 'notInLanguages',
    });
  });

  it('refreshMenuButton updates only the button and keeps the other sync results; never throws', async () => {
    const { svc, calls, row, client } = setup();
    await svc.apply(ORG);
    client.call.mockClear();

    await svc.refreshMenuButton(ORG);
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(calls('setChatMenuButton')).toHaveLength(1);
    expect(row().sync_result.name).toEqual({ status: 'ok' });

    client.call.mockRejectedValue(
      new TelegramApiError('setChatMenuButton', 'boom'),
    );
    await expect(svc.refreshMenuButton(ORG)).resolves.toBeUndefined();
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
