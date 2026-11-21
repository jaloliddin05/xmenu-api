import { Controller, Delete, Logger, Param, Put } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppException } from 'src/infra/errors/app-exception';
import {
  createHttpApp,
  FakeOwnerSecurityNotifier,
  staffToken,
  stepUpToken,
} from 'src/infra/testing/http-app.fake';
import { StaffAccess } from '../access/staff-access.decorator';
import { FakeSms, makeStaffAuthDeps } from '../services/staff-auth.fake';
import {
  BullOwnerNotificationQueue,
  OwnerNotificationSender,
  type OwnerNotificationQueue,
} from './owner-notification.queue';
import { OwnerSecurityNotifier } from './owner-security-notifier.service';
import { ownerSecuritySms, smsVenueName } from './owner-security-texts';
import { STEP_UP_ACTIONS, StepUp } from './step-up.decorator';

const ORG = '11111111-1111-4111-8111-111111111111';

@Controller('critical')
class CriticalController {
  @StaffAccess('venue')
  @StepUp('payment_keys_changed')
  @Put(':provider')
  change(@Param('provider') provider: string) {
    if (provider === 'broken') throw new AppException('invalid_body');
    return { ok: true };
  }

  @StaffAccess('venue')
  @StepUp('organization_deleted')
  @Delete()
  remove() {
    return undefined;
  }
}

describe('step-up audit', () => {
  let app: INestApplication;
  const notifier = new FakeOwnerSecurityNotifier();

  beforeAll(async () => {
    app = await createHttpApp(
      {
        controllers: [CriticalController],
        providers: [{ provide: OwnerSecurityNotifier, useValue: notifier }],
      },
      [{ id: 'owner', organization: { id: ORG, slug: 'mant' } }],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => {
    notifier.calls.length = 0;
  });

  const put = (provider: string, stepUp = true) => {
    const req = request(app.getHttpServer())
      .put(`/critical/${provider}`)
      .set('Authorization', `Bearer ${staffToken('owner')}`);
    if (stepUp) void req.set('X-Step-Up-Token', stepUpToken('owner'));
    return req;
  };

  it('a successful critical action is reported once, with the provider and no values', async () => {
    const res = await put('click');
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(notifier.calls).toEqual([
      { action: 'payment_keys_changed', userId: 'owner', provider: 'click' },
    ]);
  });

  it('a route answering 204 is reported too', async () => {
    const res = await request(app.getHttpServer())
      .delete('/critical')
      .set('Authorization', `Bearer ${staffToken('owner')}`)
      .set('X-Step-Up-Token', stepUpToken('owner'));
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(notifier.calls.map((c) => c.action)).toEqual([
      'organization_deleted',
    ]);
  });

  it('a failed action or a missing step-up is not reported', async () => {
    expect((await put('broken')).status).toBe(400);
    const refused = await put('click', false);
    expect([refused.status, refused.body.code]).toEqual([
      403,
      'step_up_required',
    ]);
    await new Promise((r) => setImmediate(r));
    expect(notifier.calls).toEqual([]);
  });
});

describe('OwnerSecurityNotifier', () => {
  const CTX = { ip: '203.0.113.5', userAgent: 'jest' };
  const actor = {
    id: 'u1',
    phone: '+998901234567',
    organization: { id: ORG, name: 'Mant' },
  };

  it('writes the action without values and queues the SMS to the owner', async () => {
    const deps = makeStaffAuthDeps();
    const queued: { phone: string; text: string }[] = [];
    const queue: OwnerNotificationQueue = {
      enqueue: async (job) => void queued.push(job),
    };
    const notifier = new OwnerSecurityNotifier(deps.events, queue);

    await notifier.notify('payment_keys_changed', actor, CTX, 'payme');

    expect(deps.db.events).toEqual([
      expect.objectContaining({
        type: 'staff_payment_keys_changed',
        user_id: 'u1',
        organization_id: ORG,
        meta: { action: 'payment_keys_changed', provider: 'payme' },
      }),
    ]);
    expect(queued).toEqual([
      {
        phone: '+998901234567',
        text: 'В Xmenu изменены настройки (платёжные ключи Payme) заведения «Mant». Если это были не вы, смените пароль.',
      },
    ]);
  });

  it('no phone: the audit row only', async () => {
    const deps = makeStaffAuthDeps();
    const enqueue = jest.fn();
    const notifier = new OwnerSecurityNotifier(deps.events, { enqueue });
    await notifier.notify('iiko_disconnected', { ...actor, phone: null }, CTX);
    expect(deps.db.events).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('owner notification queue without workers (ORDER_QUEUES=off)', () => {
  const saved = process.env.ORDER_QUEUES;
  beforeAll(() => {
    process.env.ORDER_QUEUES = 'off';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.ORDER_QUEUES;
    else process.env.ORDER_QUEUES = saved;
    jest.restoreAllMocks();
  });

  it('sends at once; a provider failure neither throws nor rejects', async () => {
    const sms = new FakeSms();
    const queue = new BullOwnerNotificationQueue(
      new OwnerNotificationSender(sms),
    );
    await queue.enqueue({ phone: '+998901234567', text: 'hello' });
    await new Promise((r) => setImmediate(r));
    expect(sms.sent).toEqual([{ phone: '+998901234567', text: 'hello' }]);

    sms.failNext = true;
    await expect(
      queue.enqueue({ phone: '+998901234567', text: 'again' }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(sms.sent).toHaveLength(1);
  });
});

describe('owner security SMS texts', () => {
  it('every action has a text naming the venue, without technical words', () => {
    for (const action of STEP_UP_ACTIONS) {
      const text = ownerSecuritySms(action, 'Mant', 'click');
      expect(text).toContain('«Mant»');
      expect(text).toMatch(/^В Xmenu /);
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]|step|token|undefined/i);
    }
  });

  it('the venue name is one line of at most 40 characters', () => {
    expect(smsVenueName('  Mant\n  Chilonzor  ')).toBe('Mant Chilonzor');
    const long = smsVenueName('x'.repeat(100));
    expect(long).toHaveLength(40);
    expect(smsVenueName(null)).toBe('');
  });
});
