import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerAuthException } from '../../errors/customer-auth.exception';
import { CUSTOMER_ACCESS_TOKEN } from './customer-access-token.strategy';

@Injectable()
export class CustomerAccessTokenGuard extends AuthGuard(CUSTOMER_ACCESS_TOKEN) {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info?: { message?: string; name?: string },
  ): TUser {
    if (err) throw err as Error; // validate() ichidagi CustomerAuthException yoki ichki xato
    if (user) return user;

    const msg = String(info?.message ?? '');
    if (info?.name === 'TokenExpiredError')
      throw new CustomerAuthException('token_expired');
    if (/no auth token/i.test(msg))
      throw new CustomerAuthException('missing_token');
    throw new CustomerAuthException('invalid_token');
  }
}
