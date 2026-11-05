import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { FileService } from 'src/modules/file/file.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { TelegramBotProfileService } from 'src/modules/telegram/telegram-bot-profile.service';
import { TenantService } from 'src/modules/tenant/tenant.service';
import { PrismaService } from '../_prisma/prisma.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './services/organization.service';

const ID = '3f1c2a9e-5b7d-4c11-9a2e-0f6b8d4e2a10';

describe('Public organization endpoints', () => {
  const findFirst = jest.fn();
  const controller = new OrganizationController(
    new OrganizationService(
      { organization: { findFirst } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    ),
  );
  beforeEach(() => findFirst.mockReset());

  it('return-slug: answers the slug of an active venue by its UUID', async () => {
    findFirst.mockResolvedValue({ slug: 'mant' });
    await expect(controller.getSlugById(ID)).resolves.toBe('mant');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, is_active: true } }),
    );
  });

  it('return-slug: 404 for a numeric int_id without touching the database', async () => {
    await expect(controller.getSlugById('7')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('return-slug: 404 for an inactive or unknown venue', async () => {
    findFirst.mockResolvedValue(null);
    await expect(controller.getSlugById(ID)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('GET /organization/slug/:slug (removed)', () => {
  let app: INestApplication;
  const findFirst = jest.fn();
  const findUnique = jest.fn();

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [OrganizationController],
      providers: [
        OrganizationService,
        {
          provide: PrismaService,
          useValue: { organization: { findFirst, findUnique } },
        },
        { provide: FileService, useValue: {} },
        { provide: RevalidateService, useValue: {} },
        { provide: TenantService, useValue: {} },
        { provide: TelegramBotProfileService, useValue: {} },
      ],
    });
  });
  afterAll(() => app.close());

  it('no longer serves the public menu: the route is gone (404) and nothing is read', async () => {
    await request(app.getHttpServer())
      .get('/organization/slug/mant')
      .expect(404);
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
