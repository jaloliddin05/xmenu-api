import { Injectable } from '@nestjs/common';

import { UserService } from 'src/modules/user/user.service';
import { AppException } from 'src/infra/errors/app-exception';

@Injectable()
export class AuthService {
  constructor(private readonly userService: UserService) {}

  /** Resolves the user behind a staff access/refresh token; deleted and unconfirmed users are rejected. */
  async validateUserById(userId: string) {
    const user = await this.userService.findOne(userId).catch(() => null);
    if (!user || !user.isActive) {
      throw new AppException('unauthorized', {
        message: 'Valid token with non-existent or inactive user.',
      });
    }
    return user;
  }
}
