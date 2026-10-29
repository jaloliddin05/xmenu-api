import { ArgumentsHost } from '@nestjs/common';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { CustomerExceptionFilter } from './customer-exception.filter';

function run(exception: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    setHeader: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new CustomerExceptionFilter().catch(exception, host);
  return res;
}

describe('CustomerExceptionFilter', () => {
  it('returns validation failures with the per-field list in details', () => {
    const errors = [
      {
        field: 'items[0].qty',
        reason: 'max',
        message: 'qty must not be greater than 50',
      },
    ];
    const res = run(fieldErrorsException('validation_error', errors));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'validation_error',
        message: 'items[0].qty: qty must not be greater than 50',
        details: { errors },
      },
    });
  });
});
