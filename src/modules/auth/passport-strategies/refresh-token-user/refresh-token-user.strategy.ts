import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { AuthService } from '../../services/auth.service';
import { CustomerAuthService } from '../../services/customer-auth.service';

export const REFRESH_TOKEN_USER = 'refresh_token_user';

@Injectable()
export class RefreshTokenUserStrategy extends PassportStrategy(
  Strategy,
  REFRESH_TOKEN_USER,
) {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
    private readonly customerAuthService: CustomerAuthService,
  ) {
    const jwtConfig = configService.getOrThrow('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.refreshTokenSecret,
    });
  }

  async validate(payload: { sub: string; role: string }) {
    if (payload.role == 'user') {
      const user = await this.authService.validateUserById(payload.sub);
      return user;
    } else {
      const user = await this.customerAuthService.validateCustomerById(
        payload.sub,
      );
      return user;
    }
  }
}
