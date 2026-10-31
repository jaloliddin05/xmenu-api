import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_KEY } from 'src/modules/auth/decorators/public.decorator';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import type { RateRule } from 'src/modules/auth/services/rate-limit.service';
import { requestCtx } from './request-helpers';

const num = (v: string | undefined, d: number) =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;

/** Every public POST per client IP (PUBLIC_POST_RATE_LIMIT per PUBLIC_POST_RATE_WINDOW_SECONDS, default 120 / 60 s). */
export const publicPostRate = (env = process.env) => ({
  limit: num(env.PUBLIC_POST_RATE_LIMIT, 120),
  ttlSeconds: num(env.PUBLIC_POST_RATE_WINDOW_SECONDS, 60),
});

/** POST /application per IP (APPLICATION_RATE_LIMIT per APPLICATION_RATE_WINDOW_SECONDS, default 5 / 1 h). */
export const applicationRate = (env = process.env) => ({
  limit: num(env.APPLICATION_RATE_LIMIT, 5),
  ttlSeconds: num(env.APPLICATION_RATE_WINDOW_SECONDS, 3600),
});

export interface PublicRateLimitOptions {
  /** Names the counter, so routes do not share one. */
  bucket: string;
  /** Read per request, so the env can be tuned without a rebuild. */
  rate: () => { limit: number; ttlSeconds: number };
}

const EXTRA_KEY = 'PUBLIC_RATE_LIMIT';
const SKIP_KEY = 'SKIP_PUBLIC_RATE_LIMIT';

/** An extra, stricter per-IP limit for one public POST route, on top of the general one. */
export const PublicRateLimit = (options: PublicRateLimitOptions) =>
  SetMetadata(EXTRA_KEY, options);

/** No limit: webhooks of providers (Click, Payme, Telegram) come from a handful of their IPs. */
export const SkipPublicRateLimit = () => SetMetadata(SKIP_KEY, true);

/**
 * Global guard: counts POST requests to @Public() routes per client IP (Redis, the same counters as
 * the OTP limits) and answers 429 rate_limited with Retry-After when the window is used up.
 * Routes with a token (staff, customer) pass through `@Public()` only to skip the staff guard, so they
 * are counted too, with the generous general limit.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method !== 'POST') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_KEY, targets))
      return true;

    const { ip } = requestCtx(req);
    const general = publicPostRate();
    const rules: RateRule[] = [{ key: `pubpost:all:${ip}`, ...general }];
    const extra = this.reflector.getAllAndOverride<
      PublicRateLimitOptions | undefined
    >(EXTRA_KEY, targets);
    if (extra) {
      rules.push({ key: `pubpost:${extra.bucket}:${ip}`, ...extra.rate() });
    }
    await this.rateLimit.hit(rules);
    return true;
  }
}
