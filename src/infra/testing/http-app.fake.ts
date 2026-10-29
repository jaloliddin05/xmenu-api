import {
  INestApplication,
  ModuleMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { ErrorFilter } from 'src/infra/validators';
import { createValidationPipe } from 'src/infra/validators/validation-errors';
import { AccessTokenUserGuard } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.guard';
import { AccessTokenUserStrategy } from 'src/modules/auth/passport-strategies/access-token-user/access-token-user.strategy';
import { AuthService } from 'src/modules/auth/services/auth.service';

const SECRET = 'http-spec-access-secret';

export interface FakeStaffUser {
  id: string;
  isActive?: boolean;
  organization: { id: string; slug?: string } | null;
}

/** Bearer access token for a staff user of createHttpApp(). */
export function staffToken(userId: string, secret = SECRET): string {
  return sign({ sub: userId, role: 'user' }, secret, { expiresIn: 60 });
}

/**
 * The app as main.ts wires it (ValidationPipe, ErrorFilter, global staff AccessTokenUserGuard with the
 * real passport strategy), around the given controllers and providers. Staff users come from
 * `staffUsers` instead of the database, with the same rule as AuthService: missing or inactive is 401.
 */
export async function createHttpApp(
  meta: ModuleMetadata,
  staffUsers: FakeStaffUser[] = [],
): Promise<INestApplication> {
  const auth = {
    validateUserById: async (id: string) => {
      const user = staffUsers.find((u) => u.id === id);
      if (!user || user.isActive === false)
        throw new UnauthorizedException(
          'Valid token with non-existent or inactive user.',
        );
      return user;
    },
  };
  const moduleRef = await Test.createTestingModule({
    ...meta,
    providers: [
      ...(meta.providers ?? []),
      AccessTokenUserStrategy,
      { provide: AuthService, useValue: auth },
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => ({ accessTokenSecret: SECRET }) },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new ErrorFilter());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalGuards(new AccessTokenUserGuard(app.get(Reflector)));
  await app.init();
  return app;
}
