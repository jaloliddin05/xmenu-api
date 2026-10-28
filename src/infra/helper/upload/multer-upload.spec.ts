import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { MulterStorage } from './multer-upload';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);

describe('MulterStorage (image upload)', () => {
  let dir: string;
  let app: express.Express;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xmenu-up-'));
    delete process.env.UPLOAD_MAX_BYTES;
    app = express();
    app.post('/up', multer({ storage: MulterStorage(dir) }).single('file'), (req, res) => {
      res.json({ filename: req.file?.filename, path: req.file?.path });
    });
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || err.statusCode || 500).json({ message: err.message });
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['png', PNG],
    ['jpg', JPEG],
    ['gif', GIF],
    ['webp', WEBP],
  ])('accepts %s by content and names the file by detected type', async (ext, buf) => {
    const res = await request(app).post('/up').attach('file', buf, 'whatever.bin');
    expect(res.status).toBe(200);
    expect(res.body.filename).toMatch(new RegExp(`^[0-9a-f-]{36}\.${ext}$`));
    expect(readFileSync(res.body.path).equals(buf)).toBe(true);
  });

  it('rejects HTML disguised as .png and leaves nothing on disk', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.from('<script>alert(1)</script>'), 'a.png');
    expect(res.status).toBe(400);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('rejects SVG even with an image extension', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg');
    expect(res.status).toBe(400);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('ignores client extension and traversal in the file name', async () => {
    const res = await request(app).post('/up').attach('file', PNG, '../../evil.html');
    expect(res.status).toBe(200);
    expect(res.body.filename).toMatch(/\.png$/);
    expect(res.body.path.startsWith(dir)).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('rejects files over UPLOAD_MAX_BYTES (default 5 MB) with 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await request(app).post('/up').attach('file', big, 'a.png');
    expect(res.status).toBe(413);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('takes the limit from the environment', async () => {
    process.env.UPLOAD_MAX_BYTES = '100';
    const res = await request(app).post('/up').attach('file', Buffer.concat([PNG, Buffer.alloc(100)]), 'a.png');
    expect(res.status).toBe(413);
    expect(existsSync(dir) && readdirSync(dir).length).toBe(0);
  });
});
