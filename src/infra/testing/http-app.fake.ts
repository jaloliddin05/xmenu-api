import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { AppException } from 'src/infra/errors/app-exception';
import { configureErrorHandling } from 'src/infra/errors/configure';
import { AccessTokenUserGuard } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.guard';
import { StaffAccessGuard } from 'src/modules/auth/access/staff-access.guard';
import type { StaffRole } from 'src/modules/auth/access/permissions';
import { AccessTokenUserStrategy } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.strategy';
import { AuthService } from 'src/modules/auth/services/auth.service';
import { StaffSessionService } from 'src/modules/auth/services/staff-session.service';
import { StepUpGuard } from 'src/modules/auth/step-up/step-up.guard';
import { StepUpTokenService } from 'src/modules/auth/step-up/step-up-token.service';
import { StepUpAuditInterceptor } from 'src/modules/auth/step-up/step-up-audit.interceptor';
import { OwnerSecurityNotifier } from 'src/modules/auth/step-up/owner-security-notifier.service';

const SECRET = 'http-spec-access-secret';
const STEP_UP_SECRET = 'http-spec-step-up-secret';
const stepUpTokens = new StepUpTokenService(STEP_UP_SECRET);

export interface FakeStaffUser {
  id: string;
  isActive?: boolean;
  /** owner unless given; null = no venue role (rejected like a disabled user) */
  role?: StaffRole | null;
  organization: { id: string; slug?: string } | null;
}

/** Bearer access token for a staff user of createHttpApp(). */
export function staffToken(
  userId: string,
  secret = SECRET,
  sid = `sid-${userId}`,
): string {
  return sign({ sub: userId, role: 'user', sid }, secret, { expiresIn: 60 });
}

/** X-Step-Up-Token for a staff user of createHttpApp() (same login as staffToken() unless `sid` is given). */
export function stepUpToken(userId: string, sid = `sid-${userId}`): string {
  return stepUpTokens.issue(userId, sid).token;
}

/** Records the critical actions instead of the audit and the SMS, unless a spec brings its own OwnerSecurityNotifier. */
export class FakeOwnerSecurityNotifier {
  readonly calls: { action: string; userId: string; provider?: string }[] = [];
  notify(
    action: string,
    actor: { id: string },
    _ctx: unknown,
    provider?: string,
  ) {
    this.calls.push({ action, userId: actor.id, provider });
    return Promise.resolve();
  }
}

/**
 * The app as main.ts wires it (request ids, AppErrorFilter, ValidationPipe, global staff AccessTokenUserGuard with the
 * real passport strategy, then StaffAccessGuard), around the given controllers and providers. Staff users come from
 * `staffUsers` instead of the database, with the same rule as AuthService: missing or inactive is 401.
 */
export async function createHttpApp(
  meta: ModuleMetadata,
  staffUsers: FakeStaffUser[] = [],
  revokedSids: Set<string> = new Set(),
  /** Builds any provider nobody gave (Test.createTestingModule().useMocker). */
  mocker?: (token: unknown) => unknown,
): Promise<INestApplication> {
  // A spec that brings its own StaffSessionService keeps it
  const ownsSessions = (meta.providers ?? []).some(
    (p) =>
      p === StaffSessionService ||
      (p as { provide?: unknown }).provide === StaffSessionService,
  );
  const auth = {
    validateUserById: async (id: string) => {
      const found = staffUsers.find((u) => u.id === id);
      const user = found && {
        ...found,
        role: found.role === undefined ? 'owner' : found.role,
      };
      if (!user || user.isActive === false || !user.role)
        throw new AppException('unauthorized', {
          message: 'Valid token with non-existent or inactive user.',
        });
      return user;
    },
  };
  const builder = Test.createTestingModule({
    ...meta,
    providers: [
      ...(meta.providers ?? []),
      AccessTokenUserStrategy,
      { provide: AuthService, useValue: auth },
      ...(ownsSessions
        ? []
        : [
            {
              provide: StaffSessionService,
              useValue: {
                isSidRevoked: async (sid: string) => revokedSids.has(sid),
              },
            },
          ]),
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => ({ accessTokenSecret: SECRET }) },
      },
    ],
  });
  if (mocker) builder.useMocker(mocker as never);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureErrorHandling(app);
  const reflector = app.get(Reflector);
  app.useGlobalGuards(
    new AccessTokenUserGuard(reflector),
    new StaffAccessGuard(reflector),
    new StepUpGuard(reflector, stepUpTokens),
  );
  let notifier: OwnerSecurityNotifier;
  try {
    notifier = app.get(OwnerSecurityNotifier, { strict: false });
  } catch {
    notifier = new FakeOwnerSecurityNotifier() as never;
  }
  app.useGlobalInterceptors(new StepUpAuditInterceptor(reflector, notifier));
  await app.init();
  // One listening server per app: otherwise supertest opens a new ephemeral server for every request, and
  // parallel requests race for connections (ECONNRESET on slow runners).
  await app.listen(0, '127.0.0.1');
  return app;
}
