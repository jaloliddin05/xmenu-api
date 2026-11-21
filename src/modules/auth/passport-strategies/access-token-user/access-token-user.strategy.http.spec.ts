import { Controller, Get, INestApplication } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import {
  AUD_CUSTOMER,
  ISSUER,
} from 'src/modules/auth/services/customer-token.service';
import { STAFF_TOKEN } from 'src/modules/auth/jwt.service';

// The secret createHttpApp() verifies staff tokens with
const SECRET = 'http-spec-access-secret';
const USER = 'user-1';
const claims = { sub: USER, role: 'user', sid: `sid-${USER}` };

@Controller('probe')
class ProbeController {
  @StaffAccess('profile')
  @Get()
  get() {
    return { ok: true };
  }
}

describe('Staff access token: algorithm, audience and issuer are pinned', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({ controllers: [ProbeController] }, [
      { id: USER, organization: { id: 'org-1' } },
    ]);
  });
  afterAll(() => app.close());

  const call = (token: string) =>
    request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

  it('a token signed as the API signs it passes', async () => {
    expect((await call(staffToken(USER))).status).toBe(200);
  });

  it('another HMAC algorithm with the same secret is 401', async () => {
    const token = sign(claims, SECRET, {
      expiresIn: 60,
      ...STAFF_TOKEN,
      algorithm: 'HS512',
    });
    const res = await call(token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('an unsigned token (alg none) is 401', async () => {
    const token = sign(claims, '', {
      expiresIn: 60,
      audience: STAFF_TOKEN.audience,
      issuer: STAFF_TOKEN.issuer,
      algorithm: 'none',
    });
    expect((await call(token)).status).toBe(401);
  });

  it('a token without an audience is 401', async () => {
    const token = sign(claims, SECRET, {
      expiresIn: 60,
      algorithm: 'HS256',
      issuer: STAFF_TOKEN.issuer,
    });
    expect((await call(token)).status).toBe(401);
  });

  it('a token of another issuer is 401', async () => {
    const token = sign(claims, SECRET, {
      expiresIn: 60,
      algorithm: 'HS256',
      audience: STAFF_TOKEN.audience,
      issuer: 'someone-else',
    });
    expect((await call(token)).status).toBe(401);
  });

  it('a customer token is 401, even signed with the staff secret', async () => {
    const customer = { sub: USER, tid: 'org-1', sid: `sid-${USER}` };
    const options = {
      expiresIn: 60,
      algorithm: 'HS256',
      audience: AUD_CUSTOMER,
      issuer: ISSUER,
    } as const;
    expect(
      (await call(sign(customer, 'customer-secret', options))).status,
    ).toBe(401);
    expect((await call(sign(customer, SECRET, options))).status).toBe(401);
  });
});
