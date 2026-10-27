import * as bcrypt from 'bcrypt';
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

  async validateUserByUsernamePassword(phone: string, password: string) {
    const user = await this.userService.findByPhone(phone);

    if (!user) {
      throw new BadRequestException('Invalid phone.');
    }

    const isPasswordSame = await this.comparePasswordWithHash(
      password,
      user?.password,
    );
    if (!isPasswordSame) {
      throw new BadRequestException('Invalid password');
    }
    return user;
  }

  async validateUserById(userId: string) {
    const user = await this.userService.findOne(userId).catch(() => {
      throw new BadRequestException('Valid token with non-existent user.');
    });
    return user;
  }

  async comparePasswordWithHash(password, hash) {
    const isSame = await bcrypt.compare(password, hash);
    return isSame;
  }

  getJWT(type: 'access' | 'refresh', sub: string) {
    return this.jwtTokenService.getJWT(type,sub,'user')
  }
}
