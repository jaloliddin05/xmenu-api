import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from 'src/infra/errors/app-exception';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { STAFF_ACCESS_KEY } from './staff-access.decorator';
import type { StaffAccessRule } from './staff-access.decorator';
import { roleCan } from './permissions';
import type { StaffRole } from './permissions';

interface GuardedRequest {
  params?: Record<string, string>;
  user?: { role?: StaffRole | null; organization?: { id?: string } | null };
}

/**
 * Runs after AccessTokenUserGuard on every staff route: the route's StaffAccess rule against the
 * caller's role. No rule = denied. An organization id in the path must be the caller's (404 otherwise).
 */
@Injectable()
export class StaffAccessGuard implements CanActivate {
  private readonly logger = new Logger('StaffAccess');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;

    const rule = this.reflector.get<StaffAccessRule | undefined>(
      STAFF_ACCESS_KEY,
      context.getHandler(),
    );
    if (!rule) {
      this.logger.error(
        `Route without an access rule: ${context.getClass().name}.${context.getHandler().name}`,
      );
      throw new AppException('forbidden', { message: 'Forbidden' });
    }
    // PlatformAdminGuard (on the route) decides
    if (rule.permission === 'platform-admin') return true;

    const req = context.switchToHttp().getRequest<GuardedRequest>();
    if (!roleCan(req.user?.role, rule.permission))
      throw new AppException('forbidden', { message: 'Forbidden' });

    if (rule.orgParam) {
      const own = req.user?.organization?.id;
      // Same answer as requireStaffOrganizationId
      if (!own)
        throw new AppException('forbidden', {
          message: 'User has no organization',
        });
      if (req.params?.[rule.orgParam] !== own)
        throw new AppException('not_found', {
          message: 'Organization not found',
        });
    }
    return true;
  }
}
