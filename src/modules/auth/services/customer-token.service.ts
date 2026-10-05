import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';

export const ISSUER = 'xmenu';
export const AUD_CUSTOMER = 'xmenu:customer';
export const AUD_REGISTRATION = 'xmenu:registration';

export interface RegistrationClaims {
  phone: string;
  tid: string;
  jti: string;
}

/** Xodimlar JwtModule'idan alohida, o'z secretlari bilan. Algoritm allowlist: faqat HS256. */
@Injectable()
export class CustomerTokenService {
  private readonly jwt = new JwtService();

  constructor(@Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig) {}

  signAccess(customerId: string, tenantId: string, sid: string): string {
    return this.jwt.sign(
      { tid: tenantId, sid },
      {
        secret: this.cfg.accessSecret,
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUD_CUSTOMER,
        subject: customerId,
        expiresIn: this.cfg.accessTtlSeconds,
      },
    );
  }

  signRegistration(phone: string, tenantId: string): string {
    return this.jwt.sign(
      { phone, tid: tenantId },
      {
        secret: this.cfg.registrationSecret,
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUD_REGISTRATION,
        jwtid: randomUUID(),
        expiresIn: this.cfg.registrationTtlSeconds,
      },
    );
  }

  verifyRegistration(token: string, tenantId: string): RegistrationClaims {
    let payload: any;
    try {
      payload = this.jwt.verify(token, {
        secret: this.cfg.registrationSecret,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUD_REGISTRATION,
      });
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') throw new CustomerAuthException('registration_expired');
      throw new CustomerAuthException('invalid_registration_token');
    }
    if (payload.tid !== tenantId || !payload.phone || !payload.jti) {
      throw new CustomerAuthException('invalid_registration_token');
    }
    return { phone: payload.phone, tid: payload.tid, jti: payload.jti };
  }
}
