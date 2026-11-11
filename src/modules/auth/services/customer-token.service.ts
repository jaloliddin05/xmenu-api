import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { AppException } from 'src/infra/errors/app-exception';

export const ISSUER = 'xmenu';
export const AUD_CUSTOMER = 'xmenu:customer';
export const AUD_REGISTRATION = 'xmenu:registration';

export interface RegistrationClaims {
  phone: string;
  tid: string;
  jti: string;
  /** Telegram user who proved the phone in the Mini App (instant mode): linked on register */
  tg?: string;
}

/** Xodimlar JwtModule'idan alohida, o'z secretlari bilan. Algoritm allowlist: faqat HS256. */
@Injectable()
export class CustomerTokenService {
  private readonly jwt = new JwtService();

  constructor(
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
  ) {}

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

  signRegistration(
    phone: string,
    tenantId: string,
    telegramId?: string,
  ): string {
    return this.jwt.sign(
      { phone, tid: tenantId, ...(telegramId ? { tg: telegramId } : {}) },
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
    let payload: Partial<RegistrationClaims>;
    try {
      payload = this.jwt.verify<Partial<RegistrationClaims>>(token, {
        secret: this.cfg.registrationSecret,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUD_REGISTRATION,
      });
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'TokenExpiredError')
        throw new AppException('registration_expired');
      throw new AppException('invalid_registration_token');
    }
    if (payload.tid !== tenantId || !payload.phone || !payload.jti) {
      throw new AppException('invalid_registration_token');
    }
    return {
      phone: payload.phone,
      tid: payload.tid,
      jti: payload.jti,
      ...(typeof payload.tg === 'string' && payload.tg
        ? { tg: payload.tg }
        : {}),
    };
  }
}
