import { Controller, Get } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { ErrorFilter } from '../validators';
import { configureStatic } from './static-assets';

@Controller()
class Dummy {
  @Get('ping')
  ping() {
    return 'pong';
  }
}

describe('configureStatic', () => {
  let root: string;
  let app: NestExpressApplication;

  beforeAll(async () => {
    const parent = mkdtempSync(join(tmpdir(), 'xmenu-static-'));
    root = join(parent, 'uploads');
    mkdirSync(join(root, 'image'), { recursive: true });
    writeFileSync(join(root, 'image', 'a.png'), Buffer.from([0x89, 0x50]));
    writeFileSync(join(root, 'image', 'evil.html'), '<script>alert(1)</script>');
    writeFileSync(join(root, 'image', 'evil.svg'), '<svg onload="alert(1)"/>');
    writeFileSync(join(parent, 'secret.txt'), 'FILE-BODY-9f3');
    const mod = await Test.createTestingModule({ controllers: [Dummy] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    app.useGlobalFilters(new ErrorFilter());
    configureStatic(app, root);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(join(root, '..'), { recursive: true, force: true });
  });

  it('serves images with nosniff and no forced download', async () => {
    const res = await request(app.getHttpServer()).get('/image/a.png');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it.each(['/image/evil.html', '/image/evil.svg'])('serves %s only as a sandboxed attachment', async (url) => {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('answers a missing file with a 404 that does not leak a filesystem path', async () => {
    for (const url of ['/image/nope.png', '/', '/index.html']) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(404);
      const body = JSON.stringify(res.body) + res.text;
      expect(body).not.toMatch(/ENOENT|uploads|xmenu-static|[A-Za-z]:\|\/tmp|\/Users/);
    }
  });

  it('does not escape the uploads directory', async () => {
    for (const url of ['/..%2fsecret.txt', '/image/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt']) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('FILE-BODY-9f3');
    }
  });

  it('keeps regular routes working', async () => {
    expect((await request(app.getHttpServer()).get('/ping')).text).toBe('pong');
  });
});
