import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  /** Branches of the venue the device follows; empty or missing = all */
  branchIds?: string[];
}

/**
 * Web push subscriptions of staff browsers (docs/API.md, "Web push сотрудникам"). A subscription belongs to the
 * user who signed in on that browser and to their venue; the endpoint identifies it.
 */
@Injectable()
export class PushSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saves the browser's subscription for this user. The same endpoint again (keys renewed, or another staff
   * member signed in on that browser) takes the row over: the browser notifies whoever is signed in now. The
   * branch choice is the device's whole state: a repeat replaces it.
   */
  async subscribe(
    userId: string,
    organizationId: string,
    input: PushSubscriptionInput,
  ): Promise<void> {
    const branchIds = [...new Set(input.branchIds ?? [])];
    if (branchIds.length > 0) {
      const own = await this.prisma.branch.count({
        where: { id: { in: branchIds }, organization_id: organizationId },
      });
      if (own !== branchIds.length)
        throw new AppException('not_found', { message: 'Branch not found' });
    }
    const data = {
      user_id: userId,
      organization_id: organizationId,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent?.slice(0, 300) || null,
      failure_count: 0,
      branch_ids: branchIds,
    };
    await this.prisma.staff_push_subscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  /** Removes the subscription of this user only; another user's endpoint is left alone (same answer). */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.staff_push_subscription.deleteMany({
      where: { endpoint, user_id: userId },
    });
  }

  /** Password reset, staff member disabled: no browser of this user gets order notifications any more. */
  async removeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.staff_push_subscription.deleteMany({
      where: { user_id: userId },
    });
    return count;
  }
}
