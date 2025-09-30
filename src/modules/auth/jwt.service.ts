import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtTokenService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  getJWT(type: 'access' | 'refresh', sub: string, role) {
    const payload = { sub, role };

    if (type === 'access') {
      return this.jwtService.sign(payload);
    }

    const jwtConfig = this.configService.getOrThrow('jwt');
    return this.jwtService.sign(payload, {
      secret: jwtConfig.refreshTokenSecret,
      expiresIn: jwtConfig.refreshTokenExpiration,
    });
  }

  generateToken(payload) {
    const jwtConfig = this.configService.getOrThrow('jwt');

    return this.jwtService.sign(payload, {
      secret: jwtConfig.accessTokenSecret,
      expiresIn: 60 * 15,
    });
  }

  async decodeToken(token: string) {
    const jwtConfig = this.configService.getOrThrow('jwt');

    const payload = await this.jwtService
      .verifyAsync(token, {
        secret: jwtConfig.accessTokenSecret,
      })
      .catch((err) => {
        throw new HttpException(err.message, 400);
      });
    return payload;
  }
}
