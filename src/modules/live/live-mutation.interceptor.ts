import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PUBLIC_KEY } from 'src/modules/auth/decorators/public.decorator';
import { LiveEventBus } from './live-event-bus';
import {
  MUTATING_METHODS,
  PUBLIC_RESOURCES,
  resourceOf,
} from './live-resources';
import type { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';

/** The browser tab that sent the change: its own stream skips the event (it already refetched). */
export const LIVE_ORIGIN_HEADER = 'x-live-origin';

/**
 * After every successful staff change, `org.changed { resources }` goes to the venue stream: another tab, another
 * operator and the owner's phone refetch what they show. Changes by guests, couriers, iiko and the platform are
 * published by their services (docs/API.md, "События (SSE)").
 */
@Injectable()
export class LiveMutationInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly bus: LiveEventBus,
    private readonly revalidate?: Pick<RevalidateService, 'addRevalidationJob'>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & { user?: { organization?: { id?: string } | null } }
      >();
    if (!MUTATING_METHODS.includes(req.method)) return next.handle();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const orgId = req.user?.organization?.id;
        const path = (req.route as { path?: string } | undefined)?.path ?? '';
        const resource = resourceOf(path);
        if (!orgId || !resource) return;
        const origin = req.header(LIVE_ORIGIN_HEADER)?.slice(0, 64) ?? null;
        void this.bus.orgChanged(orgId, [resource], origin);
        const route = PUBLIC_RESOURCES[resource];
        if (route && this.revalidate)
          void this.revalidate
            .addRevalidationJob({ tenantId: orgId, route })
            .catch(() => undefined);
      }),
    );
  }
}
