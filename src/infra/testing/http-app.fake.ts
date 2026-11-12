import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { AppException } from 'src/infra/errors/app-exception';
import { configureErrorHandling } from 'src/infra/errors/configure';
import { AccessTokenUserGuard } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.guard';
import { AccessTokenUserStrategy } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.strategy';
import { AuthService } from 'src/modules/auth/services/auth.service';
import { StaffSessionService } from 'src/modules/auth/services/staff-session.service';

const SECRET = 'http-spec-access-secret';

export interface FakeStaffUser {
  id: string;
  isActive?: boolean;
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

/**
 * The app as main.ts wires it (request ids, AppErrorFilter, ValidationPipe, global staff AccessTokenUserGuard with the
 * real passport strategy), around the given controllers and providers. Staff users come from
 * `staffUsers` instead of the database, with the same rule as AuthService: missing or inactive is 401.
 */
export async function createHttpApp(
  meta: ModuleMetadata,
  staffUsers: FakeStaffUser[] = [],
  revokedSids: Set<string> = new Set(),
): Promise<INestApplication> {
  // A spec that brings its own StaffSessionService keeps it
  const ownsSessions = (meta.providers ?? []).some(
    (p) =>
      p === StaffSessionService ||
      (p as { provide?: unknown }).provide === StaffSessionService,
  );
  const auth = {
    validateUserById: async (id: string) => {
      const user = staffUsers.find((u) => u.id === id);
      if (!user || user.isActive === false)
        throw new AppException('unauthorized', {
          message: 'Valid token with non-existent or inactive user.',
        });
      return user;
    },
  };
  const moduleRef = await Test.createTestingModule({
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
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureErrorHandling(app);
  app.useGlobalGuards(new AccessTokenUserGuard(app.get(Reflector)));
  await app.init();
  // One listening server per app: otherwise supertest opens a new ephemeral server for every request, and
  // parallel requests race for connections (ECONNRESET on slow runners).
  await app.listen(0, '127.0.0.1');
  return app;
}
