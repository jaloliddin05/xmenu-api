import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common/exceptions';

import { UserService } from 'src/modules/user/user.service';
import { JwtTokenService } from '../jwt.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtTokenService: JwtTokenService,
  ) { }

  async validateUserById(userId: string) {
    const user = await this.userService.findOne(userId).catch(() => {
      throw new BadRequestException('Valid token with non-existent user.');
    });
    return user;
  }

  getJWT(type: 'access' | 'refresh', sub: string) {
    return this.jwtTokenService.getJWT(type,sub,'user')
  }
}
