import { sign, verify } from 'jsonwebtoken';
import { AppException } from 'src/infra/errors/app-exception';

export const STEP_UP_TTL_SECONDS = 300;
export const STEP_UP_HEADER = 'x-step-up-token';
const AUDIENCE = 'xmenu:step-up';
const ISSUER = 'xmenu';

/**
 * Short-lived proof that the owner has just typed the password: bound to the user and to the login (sid) it was
 * issued for, usable any number of times until it expires. Signed with its own secret (STAFF_STEP_UP_SECRET), so
 * neither an access token nor a customer token can pass for it.
 */
export class StepUpTokenService {
  constructor(private readonly secret: string) {}

  issue(userId: string, sid: string): { token: string; expiresIn: number } {
    const token = sign({ sid }, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      audience: AUDIENCE,
      issuer: ISSUER,
      expiresIn: STEP_UP_TTL_SECONDS,
    });
    return { token, expiresIn: STEP_UP_TTL_SECONDS };
  }

  /** Throws 403 step_up_required unless the token is valid and belongs to this user and this login. */
  assertValid(token: unknown, userId: string, sid: string): void {
    let payload: { sub?: unknown; sid?: unknown } | undefined;
    if (typeof token === 'string' && token) {
      try {
        payload = verify(token, this.secret, {
          algorithms: ['HS256'],
          audience: AUDIENCE,
          issuer: ISSUER,
        }) as { sub?: unknown; sid?: unknown };
      } catch {
        payload = undefined;
      }
    }
    if (!payload || payload.sub !== userId || payload.sid !== sid)
      throw new AppException('step_up_required', {
        message: token
          ? 'Step-up token is invalid, expired or issued for another login'
          : 'Confirm the action with the password',
      });
  }
}
