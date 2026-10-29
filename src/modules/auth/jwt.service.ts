import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Staff access tokens. Refresh tokens are opaque and live in staff_session (StaffSessionService). */
@Injectable()
export class JwtTokenService {
  constructor(private jwtService: JwtService) {}

  getJWT(type: 'access', sub: string, role: string) {
    return this.jwtService.sign({ sub, role });
  }
}
