import { textProblems } from 'src/tools/user-texts/user-texts';
import { codeForStatus, ERROR_CODES, ERROR_CODE_LIST } from './error-codes';

describe('ERROR_CODES', () => {
  it.each(ERROR_CODE_LIST)('%s is well-formed', (code) => {
    const spec = ERROR_CODES[code] as {
      status: number;
      message: string;
      when: string;
      details?: readonly string[];
      deprecated?: string;
    };
    expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    expect(spec.status).toBeGreaterThanOrEqual(400);
    expect(spec.status).toBeLessThan(600);
    expect(spec.when.length).toBeGreaterThan(0);
    // The default message reaches every response: a developer hint, nothing internal
    expect(textProblems(spec.message, true)).toEqual([]);
    if (spec.deprecated) {
      expect(ERROR_CODE_LIST).toContain(spec.deprecated);
      expect(spec.deprecated).not.toBe(code);
    }
    for (const key of spec.details ?? []) expect(key).toMatch(/^[a-z]\w*$/);
  });

  it('platform_misconfigured is 503 and carries only the feature', () => {
    expect(ERROR_CODES.platform_misconfigured).toMatchObject({
      status: 503,
      details: ['feature'],
    });
  });

  it('maps framework statuses to registered codes', () => {
    expect(codeForStatus(400)).toBe('bad_request');
    expect(codeForStatus(404)).toBe('not_found');
    expect(codeForStatus(413)).toBe('payload_too_large');
    expect(codeForStatus(405)).toBe('bad_request');
    expect(codeForStatus(502)).toBe('internal_error');
    for (const s of [400, 401, 403, 404, 413, 415, 429, 500, 503, 418])
      expect(ERROR_CODE_LIST).toContain(codeForStatus(s));
  });
});
