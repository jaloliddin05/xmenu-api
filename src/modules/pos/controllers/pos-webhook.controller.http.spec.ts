import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppException } from 'src/infra/errors/app-exception';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PosWebhookService } from '../services/pos-webhook.service';
import { PosWebhookController } from './pos-webhook.controller';

const ID = '7d1f4c1e-9a0b-4c1d-8e2f-3a4b5c6d7e8f';

describe('POST /pos/iiko/:integrationId/webhook', () => {
  let app: INestApplication;
  const receive = jest.fn();

  beforeEach(async () => {
    receive.mockReset();
    app = await createHttpApp({
      controllers: [PosWebhookController],
      providers: [{ provide: PosWebhookService, useValue: { receive } }],
    });
  });

  afterEach(() => app.close());

  it('is public: no staff token, the array body and Authorization reach the service, 200', async () => {
    const events = [{ eventType: 'StopListUpdate', eventInfo: {} }];
    await request(app.getHttpServer())
      .post(`/pos/iiko/${ID}/webhook`)
      .set('Authorization', 'secret')
      .send(events)
      .expect(200, { ok: true });
    expect(receive).toHaveBeenCalledWith(ID, 'secret', events);
  });

  it('a refused secret is 401 in the common error shape', async () => {
    receive.mockRejectedValue(new AppException('unauthorized'));
    const res = await request(app.getHttpServer())
      .post(`/pos/iiko/${ID}/webhook`)
      .send([])
      .expect(401);
    expect(res.body).toMatchObject({ code: 'unauthorized', status: 401 });
  });
});
