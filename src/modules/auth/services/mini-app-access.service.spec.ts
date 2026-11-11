import { AppException } from 'src/infra/errors/app-exception';
import { INIT_DATA_CASES, InitDataCase, miniAppAccess } from './init-data.fake';

type Mode = 'site' | 'miniapp' | 'both';

describe('MiniAppAccessService.assert', () => {
  let mode: Mode;
  let hasBot: boolean;
  const service = miniAppAccess({ mode: () => mode, hasBot: () => hasBot });

  const outcome = (header: string | undefined) =>
    service.assert('org-1', header).then(
      (user) => (user ? `user ${user.id}` : 'ok'),
      (e: AppException) => `${e.getStatus()} ${e.code}`,
    );

  beforeEach(() => {
    hasBot = true;
  });

  const expected: Record<Mode, Record<InitDataCase, string>> = {
    site: {
      absent: 'ok',
      forged: 'ok',
      expired: 'ok',
      foreignBot: 'ok',
      valid: 'ok',
    },
    miniapp: {
      absent: '403 miniapp_required',
      forged: '403 miniapp_init_data_invalid',
      expired: '403 miniapp_init_data_invalid',
      foreignBot: '403 miniapp_init_data_invalid',
      valid: 'user 555',
    },
    both: {
      absent: 'ok',
      forged: '403 miniapp_init_data_invalid',
      expired: '403 miniapp_init_data_invalid',
      foreignBot: '403 miniapp_init_data_invalid',
      valid: 'user 555',
    },
  };

  describe.each(Object.keys(expected) as Mode[])('mode %s', (m) => {
    it.each(Object.keys(INIT_DATA_CASES) as InitDataCase[])(
      'initData %s',
      async (c) => {
        mode = m;
        expect(await outcome(INIT_DATA_CASES[c]())).toBe(expected[m][c]);
      },
    );
  });

  it('miniapp after the bot was removed: 503 telegram_unavailable, even with initData', async () => {
    mode = 'miniapp';
    hasBot = false;
    expect(await outcome(undefined)).toBe('503 telegram_unavailable');
    expect(await outcome(INIT_DATA_CASES.valid())).toBe(
      '503 telegram_unavailable',
    );
  });

  it('site does not touch the bot at all', async () => {
    mode = 'site';
    hasBot = false;
    expect(await outcome(INIT_DATA_CASES.valid())).toBe('ok');
  });

  it('a blank header counts as absent', async () => {
    mode = 'both';
    expect(await outcome('   ')).toBe('ok');
    mode = 'miniapp';
    expect(await outcome('   ')).toBe('403 miniapp_required');
  });
});
