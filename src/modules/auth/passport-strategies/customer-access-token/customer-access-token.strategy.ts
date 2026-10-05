import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { CUSTOMER_AUTH_CONFIG } from '../../customer-auth.config';
import type { CustomerAuthConfig } from '../../customer-auth.config';
import { CustomerAuthException } from '../../errors/customer-auth.exception';
import { AUD_CUSTOMER, ISSUER } from '../../services/customer-token.service';
import { CustomerSessionService } from '../../services/customer-session.service';

export const CUSTOMER_ACCESS_TOKEN = 'customer_access_token';

/**
 * Mijoz access-tokeni: alohida secret, aud=xmenu:customer, iss=xmenu, faqat HS256.
 * Xodim tokenlari (boshqa secret/aud) bu yerda o'tmaydi va aksincha.
 */
@Injectable()
export class CustomerAccessTokenStrategy extends PassportStrategy(Strategy, CUSTOMER_ACCESS_TOKEN) {
  constructor(
    @Inject(CUSTOMER_AUTH_CONFIG) cfg: CustomerAuthConfig,
    private readonly sessions: CustomerSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.accessSecret,
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUD_CUSTOMER,
      passReqToCallback: true,
    });
  }

  async validate(req: Request & { tenant?: { id: string } }, payload: { sub: string; tid: string; sid: string }) {
    if (!payload?.sub || !payload.tid || !payload.sid) throw new CustomerAuthException('invalid_token');

    // 403 (401 emas): klient refresh'ni aylantirib yubormasligi uchun
    if (!req.tenant || payload.tid !== req.tenant.id) throw new CustomerAuthException('tenant_mismatch');

    if (await this.sessions.isSidDenied(payload.sid)) throw new CustomerAuthException('invalid_token');

    return { customerId: payload.sub, tenantId: payload.tid, sid: payload.sid };
  }
}
