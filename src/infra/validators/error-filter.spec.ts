import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import ErrorFilter from './error-filter';

function run(exception: any) {
  const res = {
    statusCode: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
    getArgs: () => [{ route: { path: '/auth/login' } }],
  } as unknown as ArgumentsHost;
  new ErrorFilter().catch(exception, host);
  return res;
}

describe('ErrorFilter', () => {
  beforeAll(() =>
    jest.spyOn(console, 'log').mockImplementation(() => undefined),
  );

  it('adds code, retryAfter and Retry-After when the exception has them', () => {
    const res = run(
      new CustomerAuthException(
        'too_many_attempts',
        'Too many login attempts',
        120,
      ),
    );
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      status: 429,
      message: 'Too many login attempts',
      code: 'too_many_attempts',
      retryAfter: 120,
    });
    expect(res.headers['Retry-After']).toBe('120');
  });

  it('keeps the old shape for plain exceptions', () => {
    const res = run(new BadRequestException('Invalid phone number'));
    expect(res.body).toEqual({
      status: 400,
      timestamp: expect.any(String),
      message: 'Invalid phone number',
    });
    expect(res.headers).toEqual({});
  });
});
