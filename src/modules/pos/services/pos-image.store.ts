import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { lookup as dnsLookup } from 'node:dns';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { join } from 'path';
import { Env, isProduction } from 'src/config/env/env-issues';
import { isPublicAddress } from 'src/infra/http/internal-request';
import {
  BlockedAddressError,
  publicOnlyLookup,
} from 'src/infra/http/public-lookup';
import {
  detectImageExt,
  uploadMaxBytes,
} from 'src/infra/helper/upload/multer-upload';

export const POS_IMAGE_DIR = join('uploads', 'image', 'products', 'pos');
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface StoredImage {
  /** Public part after `uploads` (same as FileService.uploadFile) */
  url: string;
  path: string;
  hash: string;
}

/** IIKO_IMAGE_HOSTS: comma-separated hosts (`img.example.com`) or wildcards (`*.example.com`); empty = any public host. */
export function iikoImageHosts(env: Env = process.env): string[] {
  return (env.IIKO_IMAGE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

/** Whether the picture host is on the list (`*.example.com` matches subdomains only); an empty list allows any. */
export function imageHostAllowed(host: string, list: string[]): boolean {
  if (!list.length) return true;
  const h = host.toLowerCase().replace(/\.$/, '');
  return list.some((entry) =>
    entry.startsWith('*.') ? h.endsWith(entry.slice(1)) : h === entry,
  );
}

/**
 * Outside production the fake iiko of tests and e2e (IIKO_API_BASE_URL, a loopback address) serves the pictures
 * too: its origin skips the address check. Production never trusts it (there the base is an official iiko host).
 */
function trustedTestOrigin(url: URL, env: Env = process.env): boolean {
  if (isProduction(env) || !env.IIKO_API_BASE_URL) return false;
  try {
    return new URL(env.IIKO_API_BASE_URL).origin === url.origin;
  } catch {
    return false;
  }
}

/**
 * Copies a POS picture into Xmenu storage (never links to the POS host). The file is named by the
 * sha256 of its content, so the same picture is stored once however many dishes use it. Only images
 * (by content), within UPLOAD_MAX_BYTES; https only in production.
 *
 * The address comes from the venue's iiko menu, so it is untrusted (SSRF): every hop (at most MAX_REDIRECTS
 * redirects, followed by hand) is checked again for the scheme, IIKO_IMAGE_HOSTS and the IP: an IP literal must be
 * public, a name connects only if every address it resolves to is public (publicOnlyLookup in the agent).
 */
@Injectable()
export class PosImageStore {
  /** DNS of picture hosts; tests put a fake resolver here (its answers are still checked). */
  resolve: LookupFunction = dnsLookup as LookupFunction;

  async fetch(source: string): Promise<StoredImage> {
    const max = uploadMaxBytes();
    let url = new URL(source);
    let data: ArrayBuffer | undefined;
    for (let hop = 0; data === undefined; hop++) {
      const trusted = this.check(url);
      const lookup = trusted ? this.resolve : publicOnlyLookup(this.resolve);
      const res = await axios
        .get<ArrayBuffer>(url.toString(), {
          responseType: 'arraybuffer',
          timeout: TIMEOUT_MS,
          maxContentLength: max,
          maxRedirects: 0,
          // A proxy from the environment would resolve the name itself and skip the address check
          proxy: false,
          httpAgent: new HttpAgent({ lookup }),
          httpsAgent: new HttpsAgent({ lookup }),
          validateStatus: () => true,
        })
        .catch((e: unknown) => {
          // The refused lookup reaches us wrapped by axios
          const cause = (e as { cause?: unknown } | null)?.cause;
          throw cause instanceof BlockedAddressError ? cause : e;
        });
      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.location as unknown;
        if (typeof location !== 'string' || !location)
          throw new Error('picture redirect without a location');
        if (hop >= MAX_REDIRECTS)
          throw new Error('picture address redirects too many times');
        url = new URL(location, url);
        continue;
      }
      if (res.status < 200 || res.status >= 300)
        throw new Error(`picture address answered ${res.status}`);
      data = res.data;
    }
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

  /** Throws for a hop that must not be requested; true for the trusted origin of tests (no address check). */
  private check(url: URL): boolean {
    const allowed = isProduction(process.env)
      ? ['https:']
      : ['https:', 'http:'];
    if (!allowed.includes(url.protocol))
      throw new Error('picture address is not https');
    if (url.username || url.password)
      throw new Error('picture address carries credentials');
    if (!imageHostAllowed(url.hostname, iikoImageHosts()))
      throw new BlockedAddressError('picture host is not on the allowed list');
    if (trustedTestOrigin(url)) return true;
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && !isPublicAddress(literal))
      throw new BlockedAddressError('picture address is not public');
    return false;
  }
}
