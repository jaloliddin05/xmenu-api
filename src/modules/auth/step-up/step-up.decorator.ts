import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse, ApiHeader } from '@nestjs/swagger';

export const STEP_UP_KEY = 'STEP_UP';

/** Critical owner actions: each needs a fresh password (step-up), is written to staff_auth_event and texted to the owner. */
export const STEP_UP_ACTIONS = [
  'payment_keys_changed',
  'telegram_bot_changed',
  'telegram_bot_removed',
  'iiko_key_changed',
  'iiko_disconnected',
  'organization_deleted',
  'account_deleted',
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

/**
 * The route needs `X-Step-Up-Token` from `POST /auth/step-up` (StepUpGuard, global, after StaffAccessGuard); after a
 * successful answer StepUpAuditInterceptor logs the action and queues the SMS to the owner.
 */
export const StepUp = (action: StepUpAction) =>
  applyDecorators(
    SetMetadata(STEP_UP_KEY, action),
    ApiHeader({
      name: 'X-Step-Up-Token',
      required: true,
      description:
        'Token from POST /auth/step-up (5 minutes, this login only); missing, invalid or expired: 403 step_up_required',
    }),
    ApiForbiddenResponse({
      description:
        'step_up_required: confirm the action with the password (POST /auth/step-up)',
    }),
  );
