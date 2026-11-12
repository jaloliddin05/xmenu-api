import type { IConfig } from 'src/config/config.interface';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt } from 'passport-jwt';
import { AuthService } from '../../services/auth.service';
import { StaffSessionService } from '../../services/staff-session.service';
import { AppException } from 'src/infra/errors/app-exception';
import type { StaffUser } from 'src/infra/helper/auth/staff-user';

export const ACCESS_TOKEN_USER = 'access_token_user';

@Injectable()
export class AccessTokenUserStrategy extends PassportStrategy(
  Strategy,
  ACCESS_TOKEN_USER,
) {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: StaffSessionService,
    configService: ConfigService,
  ) {
    const jwtConfig = configService.getOrThrow<IConfig['jwt']>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.accessTokenSecret,
    });
  }

  async validate(payload: {
    sub: string;
    role: string;
    sid?: string;
  }): Promise<StaffUser & { sid: string }> {
    if (!payload?.sid)
      throw new AppException('unauthorized', {
        message: 'Access token without a session.',
      });
    if (await this.sessions.isSidRevoked(payload.sid))
      throw new AppException('unauthorized', {
        message: 'The session of this token was ended.',
      });
    const user = await this.authService.validateUserById(payload.sub);
    return { ...user, sid: payload.sid };
  }
}
