import {
  Controller,
  HttpCode,
  INestApplication,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { MulterStorage, uploadLimits } from './multer-upload';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const dir = mkdtempSync(join(tmpdir(), 'xmenu-limits-'));

// Same shape as PATCH /product/:id/images: up to 10 pictures
@Controller('up')
class UploadController {
  @StaffAccess('profile')
  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'images', maxCount: 10 }], {
      storage: MulterStorage(dir),
      limits: uploadLimits(10),
    }),
  )
  upload(@UploadedFiles() files: { images?: Express.Multer.File[] }) {
    return { count: files?.images?.length ?? 0 };
  }
}

describe('Upload limits (multer)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.UPLOAD_MAX_BYTES = '1024';
    app = await createHttpApp({ controllers: [UploadController] }, [
      { id: 'owner', organization: { id: 'org-1' } },
    ]);
  });
  afterAll(async () => {
    delete process.env.UPLOAD_MAX_BYTES;
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = () =>
    request(app.getHttpServer())
      .post('/up')
      .set('Authorization', `Bearer ${staffToken('owner')}`);

  const expectContractError = (
    res: request.Response,
    status: number,
    code: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code, status });
    expect(res.body.requestId).toEqual(expect.any(String));
    // No multer or busboy text reaches the answer
    expect(JSON.stringify(res.body)).not.toMatch(/multer|busboy|LIMIT_/i);
  };

  it('ten pictures within the size pass', async () => {
    let req = post();
    for (let i = 0; i < 10; i++) req = req.attach('images', PNG, `p${i}.png`);
    const res = await req;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 10 });
  });

  it('a file over UPLOAD_MAX_BYTES is 413 payload_too_large', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
    expectContractError(
      await post().attach('images', big, 'big.png'),
      413,
      'payload_too_large',
    );
  });

  it('an eleventh file is 400 bad_request', async () => {
    let req = post();
    for (let i = 0; i < 11; i++) req = req.attach('images', PNG, `p${i}.png`);
    expectContractError(await req, 400, 'bad_request');
  });

  it('too many text fields is 400 bad_request', async () => {
    let req = post();
    for (let i = 0; i < 21; i++) req = req.field(`f${i}`, 'x');
    expectContractError(await req, 400, 'bad_request');
  });

  it('a text field over 64 KB is 400 bad_request', async () => {
    expectContractError(
      await post().field('note', 'x'.repeat(64 * 1024 + 1)),
      400,
      'bad_request',
    );
  });
});
