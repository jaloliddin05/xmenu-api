import { INestApplication } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppException } from 'src/infra/errors/app-exception';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { StaffPasswordService } from '../services/staff-password.service';
import { StaffSessionService } from '../services/staff-session.service';
import { AuthController } from './auth.controller';
import { StaffAuthService } from '../services/staff-auth.service';
import { StaffSessionsController } from './staff-sessions.controller';

const ME = 'user-me';
const SID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_SID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('owner password and sessions routes', () => {
  let app: INestApplication;
  const revoked = new Set<string>();
  const sessions = {
    isSidRevoked: jest.fn(async (sid: string) => revoked.has(sid)),
    listActive: jest.fn(async () => [{ id: SID, current: true }]),
    end: jest.fn(async (_u: string, sid: string) => {
      if (sid === OTHER_SID)
        throw new AppException('not_found', { message: 'Session not found' });
    }),
    endOthers: jest.fn(async () => undefined),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const passwords = {
    forgot: jest.fn(async () => ({
      resendAfter: 60,
      codeLength: 6,
      expiresIn: 300,
    })),
    reset: jest.fn(async () => undefined),
    change: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    app = await createHttpApp(
      {
        controllers: [AuthController, StaffSessionsController],
        providers: [
          { provide: StaffSessionService, useValue: sessions },
          { provide: StaffPasswordService, useValue: passwords },
          { provide: StaffAuthService, useValue: {} },
        ],
      },
      [{ id: ME, organization: null }],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    revoked.clear();
  });

  const bearer = () => ({
    Authorization: `Bearer ${staffToken(ME, undefined, SID)}`,
  });

  it('forgot and reset are public and answer without a token', async () => {
    const forgot = await request(app.getHttpServer())
      .post('/auth/password/forgot')
      .send({ phone: '+998 90 123 45 67' });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({
      resendAfter: 60,
      codeLength: 6,
      expiresIn: 300,
    });
    expect(passwords.forgot).toHaveBeenCalledWith(
      { phone: '+998901234567' },
      expect.objectContaining({ ip: expect.any(String) }),
    );

    const reset = await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({
        phone: '+998901234567',
        code: '123456',
        newPassword: 'long-enough-1',
      });
    expect(reset.status).toBe(204);
  });

  it('reset rejects a short new password with a field error and never calls the service', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ phone: '+998901234567', code: '123456', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.fields).toEqual([
      expect.objectContaining({ field: 'newPassword' }),
    ]);
    expect(passwords.reset).not.toHaveBeenCalled();
  });

  it.each([
    ['post', '/auth/password/change'],
    ['get', '/auth/sessions'],
    ['delete', `/auth/sessions/${SID}`],
    ['delete', '/auth/sessions'],
  ] as const)('%s %s needs an access token', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path);
    expect(res.status).toBe(401);
  });

  it('refuses an access token whose login was ended, and one without a session id', async () => {
    revoked.add(SID);
    const ended = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set(bearer());
    expect(ended.status).toBe(401);

    const legacy = sign({ sub: ME, role: 'user' }, 'http-spec-access-secret', {
      expiresIn: 60,
    });
    const res = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${legacy}`);
    expect(res.status).toBe(401);
  });

  it('change passes the user and the session of the token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/password/change')
      .set(bearer())
      .send({
        currentPassword: 'old-password-1',
        newPassword: 'long-enough-1',
      });
    expect(res.status).toBe(204);
    expect(passwords.change).toHaveBeenCalledWith(
      ME,
      SID,
      { currentPassword: 'old-password-1', newPassword: 'long-enough-1' },
      expect.anything(),
    );
  });

  it('lists sessions for the owner of the token', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set(bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: SID, current: true }]);
    expect(sessions.listActive).toHaveBeenCalledWith(ME, SID);
  });

  it('ends one login, 404 for a login that is not the owner’s, 400 for a malformed id', async () => {
    const ok = await request(app.getHttpServer())
      .delete(`/auth/sessions/${SID}`)
      .set(bearer());
    expect(ok.status).toBe(204);
    expect(sessions.end).toHaveBeenCalledWith(ME, SID, expect.anything());

    const foreign = await request(app.getHttpServer())
      .delete(`/auth/sessions/${OTHER_SID}`)
      .set(bearer());
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('not_found');

    const bad = await request(app.getHttpServer())
      .delete('/auth/sessions/not-a-uuid')
      .set(bearer());
    expect(bad.status).toBe(400);
  });

  it('ends all other logins', async () => {
    const res = await request(app.getHttpServer())
      .delete('/auth/sessions')
      .set(bearer());
    expect(res.status).toBe(204);
    expect(sessions.endOthers).toHaveBeenCalledWith(ME, SID, expect.anything());
  });
});
