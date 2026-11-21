import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { STEP_UP_KEY } from './step-up.decorator';
import type { StepUpAction } from './step-up.decorator';
import { STEP_UP_HEADER, StepUpTokenService } from './step-up-token.service';

/**
 * Global, after AccessTokenUserGuard and StaffAccessGuard (main.ts, createHttpApp): a route marked @StepUp passes only
 * with a step-up token of the same user and the same login. Other routes are not touched.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: StepUpTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.get<StepUpAction | undefined>(
      STEP_UP_KEY,
      context.getHandler(),
    );
    if (!action) return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string; sid?: string } }>();
    this.tokens.assertValid(
      req.headers[STEP_UP_HEADER],
      req.user?.id ?? '',
      req.user?.sid ?? '',
    );
    return true;
  }
}
