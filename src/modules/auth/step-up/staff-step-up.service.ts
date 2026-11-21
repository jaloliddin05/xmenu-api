import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { AppException } from 'src/infra/errors/app-exception';
import type { RequestCtx } from '../services/customer-auth-event.service';
import {
  RateLimitService,
  type RateRule,
} from '../services/rate-limit.service';
import { StaffAuthEventService } from '../services/staff-auth-event.service';
import { StepUpTokenService } from './step-up-token.service';

const WRONG_WINDOW_SECONDS = 900;
const WRONG_USER_LIMIT = 5;

/**
 * POST /auth/step-up: the password once more for a token that opens the critical actions for 5 minutes. Only wrong
 * passwords count towards the limit (5 per 15 minutes per user); the login lockout of the phone is not touched.
 */
@Injectable()
export class StaffStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly events: StaffAuthEventService,
    private readonly tokens: StepUpTokenService,
  ) {}

  async issue(
    userId: string,
    sid: string,
    password: string,
    ctx: RequestCtx,
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    const rule: RateRule = {
      key: `staff:stepup:rl:user:${userId}`,
      limit: WRONG_USER_LIMIT,
      ttlSeconds: WRONG_WINDOW_SECONDS,
    };
    // Counted before the check so parallel guesses cannot pass the limit; a right password gives the count back
    await this.rateLimit.hit([rule]);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    const same =
      !!user?.password && (await bcrypt.compare(password, user.password));
    if (!same) {
      await this.events.log('staff_step_up_failed', ctx, { userId });
      throw new AppException('wrong_password', {
        message: 'Password does not match',
      });
    }
    await this.rateLimit.rollback([rule]);

    const { token, expiresIn } = this.tokens.issue(userId, sid);
    await this.events.log('staff_step_up', ctx, { userId });
    return { stepUpToken: token, expiresIn };
  }
}
