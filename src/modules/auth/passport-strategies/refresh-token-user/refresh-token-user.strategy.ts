import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt } from 'passport-jwt';
import { AuthService } from '../../services/auth.service';

export const REFRESH_TOKEN_USER = 'refresh_token_user';

@Injectable()
export class RefreshTokenUserStrategy extends PassportStrategy(
  Strategy,
  REFRESH_TOKEN_USER,
) {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService
  ) {
    const jwtConfig = configService.getOrThrow('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.refreshTokenSecret,
    });
  }

  async validate(payload: { sub: string; role: string }) {
      const user = await this.authService.validateUserById(payload.sub);
      return user;
  }
}
