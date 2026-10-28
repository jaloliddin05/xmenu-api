import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** User ids from PLATFORM_ADMIN_USER_IDS (comma separated). Empty or unset means nobody. */
export function platformAdminIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Platform-level endpoints (not tenant data). Runs after the global access-token guard. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const id = context.switchToHttp().getRequest().user?.id;
    if (typeof id === 'string' && platformAdminIds().has(id)) return true;
    throw new ForbiddenException('Forbidden');
  }
}
