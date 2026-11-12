import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Staff access tokens. Refresh tokens are opaque and live in staff_session (StaffSessionService). */
@Injectable()
export class JwtTokenService {
  constructor(private jwtService: JwtService) {}

  /** `sid` is the login (staff_session family) the token belongs to. */
  getJWT(type: 'access', sub: string, role: string, sid: string) {
    return this.jwtService.sign({ sub, role, sid });
  }
}
