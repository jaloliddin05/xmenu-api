import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CUSTOMER_ACCESS_TOKEN } from './customer-access-token.strategy';
import { AppException } from 'src/infra/errors/app-exception';

@Injectable()
export class CustomerAccessTokenGuard extends AuthGuard(CUSTOMER_ACCESS_TOKEN) {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info?: { message?: string; name?: string },
  ): TUser {
    if (err) throw err as Error; // validate() ichidagi AppException yoki ichki xato
    if (user) return user;

    const msg = String(info?.message ?? '');
    if (info?.name === 'TokenExpiredError')
      throw new AppException('token_expired');
    if (/no auth token/i.test(msg)) throw new AppException('missing_token');
    throw new AppException('invalid_token');
  }
}
