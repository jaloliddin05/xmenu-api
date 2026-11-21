import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { requestCtx } from 'src/infra/http/request-helpers';
import { errorMessage } from 'src/infra/helper/error-text';
import { STEP_UP_KEY } from './step-up.decorator';
import type { StepUpAction } from './step-up.decorator';
import {
  OwnerSecurityNotifier,
  type CriticalActor,
} from './owner-security-notifier.service';

/**
 * Global (main.ts, createHttpApp): after a @StepUp route answered successfully, the action goes to the audit and to
 * the owner by SMS. The actor is read from the request before the handler runs, so deleting the venue or the account
 * still reaches the owner's phone.
 */
@Injectable()
export class StepUpAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('StepUpAudit');

  constructor(
    private readonly reflector: Reflector,
    private readonly notifier: OwnerSecurityNotifier,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<StepUpAction | undefined>(
      STEP_UP_KEY,
      context.getHandler(),
    );
    if (!action) return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<Request & { user: CriticalActor }>();
    const actor: CriticalActor = {
      id: req.user.id,
      phone: req.user.phone,
      organization: req.user.organization
        ? { id: req.user.organization.id, name: req.user.organization.name }
        : null,
    };
    const provider =
      typeof req.params?.provider === 'string'
        ? req.params.provider
        : undefined;
    const ctx = requestCtx(req);
    return next.handle().pipe(
      tap(() => {
        void this.notifier
          .notify(action, actor, ctx, provider)
          .catch((err) =>
            this.logger.warn(
              `${action}: owner not notified: ${errorMessage(err)}`,
            ),
          );
      }),
    );
  }
}
