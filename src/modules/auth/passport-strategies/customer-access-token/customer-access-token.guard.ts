import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerAuthException } from '../../errors/customer-auth.exception';
import { CUSTOMER_ACCESS_TOKEN } from './customer-access-token.strategy';

@Injectable()
export class CustomerAccessTokenGuard extends AuthGuard(CUSTOMER_ACCESS_TOKEN) {
  handleRequest(err: any, user: any, info: any) {
    if (err) throw err; // validate() ichidagi CustomerAuthException yoki ichki xato
    if (user) return user;

    const msg = String(info?.message ?? '');
    if (info?.name === 'TokenExpiredError') throw new CustomerAuthException('token_expired');
    if (/no auth token/i.test(msg)) throw new CustomerAuthException('missing_token');
    throw new CustomerAuthException('invalid_token');
  }
}
