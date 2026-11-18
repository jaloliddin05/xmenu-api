import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { isProduction } from 'src/config/env/env-issues';
import {
  detectImageExt,
  uploadMaxBytes,
} from 'src/infra/helper/upload/multer-upload';

export const POS_IMAGE_DIR = join('uploads', 'image', 'products', 'pos');
const TIMEOUT_MS = 10_000;

export interface StoredImage {
  /** Public part after `uploads` (same as FileService.uploadFile) */
  url: string;
  path: string;
  hash: string;
}

/**
 * Copies a POS picture into Xmenu storage (never links to the POS host). The file is named by the
 * sha256 of its content, so the same picture is stored once however many dishes use it. Only images
 * (by content), within UPLOAD_MAX_BYTES; https only in production.
 */
@Injectable()
export class PosImageStore {
  async fetch(source: string): Promise<StoredImage> {
    const url = new URL(source);
    const allowed = isProduction(process.env)
      ? ['https:']
      : ['https:', 'http:'];
    if (!allowed.includes(url.protocol))
      throw new Error('picture address is not https');
    const max = uploadMaxBytes();
    const { data } = await axios.get<ArrayBuffer>(url.toString(), {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_MS,
      maxContentLength: max,
      maxRedirects: 3,
    });
    const buf = Buffer.from(data);
    if (buf.length > max) throw new Error('picture is too large');
    const ext = detectImageExt(buf);
    if (!ext) throw new Error('not an image');
    const hash = createHash('sha256').update(buf).digest('hex');
    mkdirSync(POS_IMAGE_DIR, { recursive: true });
    const path = join(POS_IMAGE_DIR, `${hash}.${ext}`);
    if (!existsSync(path)) await writeFile(path, buf);
    return { url: path.split('uploads')[1], path, hash };
  }
}
