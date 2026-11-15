import { Injectable } from '@nestjs/common';

import { UserService } from 'src/modules/user/user.service';
import { AppException } from 'src/infra/errors/app-exception';

@Injectable()
export class AuthService {
  constructor(private readonly userService: UserService) {}

  /**
   * Resolves the user behind a staff access/refresh token; deleted, unconfirmed and disabled users
   * (no active membership in a venue) are rejected. Read on every request, so disabling acts at once.
   */
  async validateUserById(userId: string) {
    const user = await this.userService.findOne(userId).catch(() => null);
    if (!user || !user.isActive || !user.role) {
      throw new AppException('unauthorized', {
        message: 'Valid token with non-existent or inactive user.',
      });
    }
    return user;
  }
}
