import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';

/** User ids from PLATFORM_ADMIN_USER_IDS (comma separated). Empty or unset means nobody. */
export function platformAdminIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
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
    const id = context.switchToHttp().getRequest<{ user?: { id?: unknown } }>()
      .user?.id;
    if (typeof id === 'string' && platformAdminIds().has(id)) return true;
    throw new AppException('forbidden', { message: 'Forbidden' });
  }
}
