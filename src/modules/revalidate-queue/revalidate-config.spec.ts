import {
  assertRevalidateConfig,
  revalidateConfigProblems,
} from './revalidate-config';

const ok = {
  NEXT_PUBLIC_URL: 'https://qr.xmenu.uz',
  REVALIDATE_SECRET: 'q',
  CLIENT_REVALIDATE_URL: 'http://127.0.0.1:3002/api/revalidate',
  CLIENT_REVALIDATE_SECRET: 'c',
};

describe('revalidate configuration', () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockClear());

  it('is silent when every configured target has its secret, or the client target is off', () => {
    expect(revalidateConfigProblems(ok)).toEqual([]);
    expect(
      revalidateConfigProblems({
        ...ok,
        CLIENT_REVALIDATE_URL: '',
        CLIENT_REVALIDATE_SECRET: '',
      }),
    ).toEqual([]);
    expect(revalidateConfigProblems({})).toEqual([]);
  });

  it('names the target whose secret is missing (blank counts as empty)', () => {
    expect(
      revalidateConfigProblems({ ...ok, CLIENT_REVALIDATE_SECRET: ' ' }),
    ).toEqual([expect.stringContaining('CLIENT_REVALIDATE_SECRET')]);
    expect(revalidateConfigProblems({ ...ok, REVALIDATE_SECRET: '' })).toEqual([
      expect.stringContaining('REVALIDATE_SECRET is empty'),
    ]);
  });

  it('production refuses to start', () => {
    expect(() =>
      assertRevalidateConfig(
        { ...ok, NODE_ENV: 'production', CLIENT_REVALIDATE_SECRET: '' },
        { warn },
      ),
    ).toThrow(/CLIENT_REVALIDATE_SECRET/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('development only warns', () => {
    expect(() =>
      assertRevalidateConfig(
        { ...ok, NODE_ENV: 'development', CLIENT_REVALIDATE_SECRET: '' },
        { warn },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('CLIENT_REVALIDATE_SECRET');
  });

  it('production with a complete configuration starts quietly', () => {
    assertRevalidateConfig({ ...ok, NODE_ENV: 'production' }, { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
