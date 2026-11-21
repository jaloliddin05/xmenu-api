import { Inject, Injectable } from '@nestjs/common';
import type { RequestCtx } from '../services/customer-auth-event.service';
import { StaffAuthEventService } from '../services/staff-auth-event.service';
import {
  OWNER_NOTIFICATION_QUEUE,
  type OwnerNotificationQueue,
} from './owner-notification.queue';
import { ownerSecuritySms, smsVenueName } from './owner-security-texts';
import type { StepUpAction } from './step-up.decorator';

export interface CriticalActor {
  id: string;
  phone?: string | null;
  organization?: { id: string; name?: string | null } | null;
}

/**
 * After a critical owner action: an audit row (what changed, never the values) and an SMS to the owner's phone in
 * the background. Neither can fail the action.
 */
@Injectable()
export class OwnerSecurityNotifier {
  constructor(
    private readonly events: StaffAuthEventService,
    @Inject(OWNER_NOTIFICATION_QUEUE)
    private readonly queue: OwnerNotificationQueue,
  ) {}

  async notify(
    action: StepUpAction,
    actor: CriticalActor,
    ctx: RequestCtx,
    provider?: string,
  ): Promise<void> {
    await this.events.log(`staff_${action}`, ctx, {
      userId: actor.id,
      organizationId: actor.organization?.id,
      meta: provider ? { action, provider } : { action },
    });
    if (!actor.phone) return;
    await this.queue.enqueue({
      phone: actor.phone,
      text: ownerSecuritySms(
        action,
        smsVenueName(actor.organization?.name),
        provider,
      ),
    });
  }
}
