import {
  parseArgs,
  runAnonymizeGuest,
  type AnonymizeGuestDeps,
} from './anonymize-guest';

const result = {
  customerId: 'c1',
  dryRun: true,
  addresses: 2,
  sessions: 1,
  authEvents: 3,
  orders: 4,
};

function deps(over: Partial<AnonymizeGuestDeps> = {}): AnonymizeGuestDeps {
  return {
    findTenantId: jest.fn(async () => 't1'),
    findGuestId: jest.fn(async () => 'c1'),
    deleteGuest: jest.fn(async (_t, _c, opts) => ({
      ...result,
      dryRun: opts.dryRun,
    })),
    ...over,
  };
}

describe('parseArgs', () => {
  it('is a dry run unless --apply', () => {
    expect(parseArgs(['--tenant', 'mant', '--phone', '+998901234567'])).toEqual(
      { tenant: 'mant', phone: '+998901234567', apply: false },
    );
    expect(
      parseArgs(['--tenant', 'mant', '--phone', '+998901234567', '--apply']),
    ).toMatchObject({ apply: true });
  });

  it('rejects a missing tenant and a bad phone', () => {
    expect(typeof parseArgs(['--phone', '+998901234567'])).toBe('string');
    expect(typeof parseArgs(['--tenant', 'mant', '--phone', '123'])).toBe(
      'string',
    );
  });
});

describe('runAnonymizeGuest', () => {
  const args = { tenant: 'mant', phone: '+998901234567', apply: false };

  it('dry run: asks the service for a dry run and says nothing was written', async () => {
    const d = deps();
    const out = await runAnonymizeGuest(args, d);
    expect(d.deleteGuest).toHaveBeenCalledWith('t1', 'c1', { dryRun: true });
    expect(out.code).toBe(0);
    expect(out.lines[0]).toContain('DRY RUN');
    expect(out.lines.join('\n')).toContain('orders anonymized: 4');
  });

  it('--apply runs it for real', async () => {
    const d = deps();
    const out = await runAnonymizeGuest({ ...args, apply: true }, d);
    expect(d.deleteGuest).toHaveBeenCalledWith('t1', 'c1', { dryRun: false });
    expect(out.lines[0]).toBe('APPLIED');
  });

  it('never prints the full phone', async () => {
    const out = await runAnonymizeGuest(args, deps());
    expect(out.lines.join('\n')).not.toContain('+998901234567');
  });

  it('unknown venue or guest: exit code 1, nothing deleted', async () => {
    const noVenue = deps({ findTenantId: jest.fn(async () => null) });
    expect((await runAnonymizeGuest(args, noVenue)).code).toBe(1);
    const noGuest = deps({ findGuestId: jest.fn(async () => null) });
    expect((await runAnonymizeGuest(args, noGuest)).code).toBe(1);
    expect(noVenue.deleteGuest).not.toHaveBeenCalled();
    expect(noGuest.deleteGuest).not.toHaveBeenCalled();
  });
});
