import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlink } from 'fs';
import { join } from 'path';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';

export const decodeFilename = (filename: string): string => {
  return Buffer.from(filename, 'latin1').toString('utf8');
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Upload size limit in bytes: UPLOAD_MAX_BYTES, default 5 MB. */
export const uploadMaxBytes = (): number => {
  const n = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
};

/** Image type by magic bytes (never by the client's extension or MIME). SVG is deliberately not allowed. */
export function detectImageExt(b: Buffer): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Multer storage that accepts images only. The upload is buffered (bounded by UPLOAD_MAX_BYTES), the type
 * is detected from the content, and only then written to disk under a random name with the detected
 * extension, so a rejected upload never leaves a file behind. Auth guards run before multer.
 */
class ImageStorage implements StorageEngine {
  constructor(private readonly dest: string) {}

  _handleFile(_req: Request, file: Express.Multer.File, cb: (error?: any, info?: Partial<Express.Multer.File>) => void) {
    const max = uploadMaxBytes();
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      file.stream.resume();
      cb(e);
    };

    file.stream.on('data', (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > max) return fail(new PayloadTooLargeException(`File is larger than ${max} bytes`));
      chunks.push(c);
    });
    file.stream.on('error', (e) => fail(e));
    file.stream.on('end', () => {
      if (failed) return;
      const buf = Buffer.concat(chunks);
      const ext = detectImageExt(buf);
      if (!ext) return fail(new BadRequestException('Only JPEG, PNG, GIF and WebP images are allowed'));

      mkdirSync(this.dest, { recursive: true });
      const filename = `${randomUUID()}.${ext}`;
      const path = join(this.dest, filename);
      const out = createWriteStream(path);
      out.on('error', (e) => fail(e));
      out.on('finish', () => cb(null, { destination: this.dest, filename, path, size: buf.length }));
      out.end(buf);
    });
  }

  _removeFile(_req: Request, file: Express.Multer.File, cb: (error: Error | null) => void) {
    unlink(file.path, (err) => cb(err && (err as NodeJS.ErrnoException).code !== 'ENOENT' ? err : null));
  }
}

export const MulterStorage = (dest: string): StorageEngine => new ImageStorage(dest);
