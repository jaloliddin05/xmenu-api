import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import ErrorFilter from './error-filter';
import { fieldErrorsException } from './validation-errors';

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
  const log = jest.spyOn(console, 'log');
  const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  beforeEach(() => {
    log.mockClear();
    loggerError.mockClear();
  });

  it('does not log client errors such as 401 (no stack trace in the log)', () => {
    run(new UnauthorizedException());
    run(new NotFoundException());
    expect(log).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('logs server errors with their stack', () => {
    run(new ServiceUnavailableException('down'));
    expect(loggerError).toHaveBeenCalledWith('down', expect.stringContaining('ServiceUnavailableException'));
  });

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

  it('derives the code from the status for plain exceptions', () => {
    const res = run(new BadRequestException('Invalid phone number'));
    expect(res.body).toEqual({
      status: 400,
      timestamp: expect.any(String),
      code: 'bad_request',
      message: 'Invalid phone number',
    });
    expect(res.headers).toEqual({});
    expect(run(new NotFoundException()).body).toMatchObject({ code: 'not_found', message: 'Not Found' });
    expect(run(new UnauthorizedException()).body).toMatchObject({ code: 'unauthorized' });
  });

  it('passes field errors and details through', () => {
    const errors = [{ field: 'theme.brand', reason: 'matches', message: 'brand must be a hex color' }];
    const res = run(fieldErrorsException('validation_error', errors));
    expect(res.body).toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'theme.brand: brand must be a hex color',
      errors,
    });
    const withDetails = run(new CustomerAuthException('branch_closed', 'closed', undefined, { opensAt: '09:00' }));
    expect(withDetails.body).toMatchObject({ code: 'branch_closed', details: { opensAt: '09:00' } });
  });
});
