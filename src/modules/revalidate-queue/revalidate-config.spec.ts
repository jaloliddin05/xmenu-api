import {
  revalidateConfigProblems,
  revalidateEnvIssues,
} from './revalidate-config';

const ok = {
  NEXT_PUBLIC_URL: 'https://qr.xmenu.uz',
  REVALIDATE_SECRET: 'q',
  CLIENT_REVALIDATE_URL: 'http://127.0.0.1:3002/api/revalidate',
  CLIENT_REVALIDATE_SECRET: 'c',
};

describe('revalidate configuration', () => {
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
    const issues = revalidateEnvIssues({
      ...ok,
      NODE_ENV: 'production',
      CLIENT_REVALIDATE_SECRET: '',
    });
    expect(issues.errors).toEqual([
      expect.stringContaining('CLIENT_REVALIDATE_SECRET'),
    ]);
    expect(issues.warnings).toEqual([]);
  });

  it('development only warns', () => {
    const issues = revalidateEnvIssues({
      ...ok,
      NODE_ENV: 'development',
      CLIENT_REVALIDATE_SECRET: '',
    });
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toEqual([
      expect.stringContaining('CLIENT_REVALIDATE_SECRET'),
    ]);
  });

  it('production with a complete configuration has no issues', () => {
    expect(revalidateEnvIssues({ ...ok, NODE_ENV: 'production' })).toEqual({
      errors: [],
      warnings: [],
    });
  });
});
