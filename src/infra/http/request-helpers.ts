import { ForbiddenException } from '@nestjs/common';

export type Lang = 'ru' | 'uz' | 'en';

/** ?lang=uz yoki Accept-Language: uz-UZ,ru;q=0.8 → 'ru' | 'uz' | 'en' (standart: ru). */
export function resolveLang(req: { query?: Record<string, any>; headers?: Record<string, any> }): Lang {
  const pick = (v: unknown): Lang | null => {
    const code = typeof v === 'string' ? v.trim().toLowerCase().slice(0, 2) : '';
    return code === 'ru' || code === 'uz' || code === 'en' ? code : null;
  };
  const fromQuery = pick(req.query?.lang);
  if (fromQuery) return fromQuery;

  const header = String(req.headers?.['accept-language'] ?? '');
  for (const part of header.split(',')) {
    const lang = pick(part.split(';')[0]);
    if (lang) return lang;
  }
  return 'ru';
}

/** Client IP and user agent for rate limits and audit (IP honours `trust proxy` set in main.ts). */
export function requestCtx(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, any>;
}): { ip: string; userAgent: string } {
  return {
    ip: req.ip || req.socket?.remoteAddress || '',
    userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 255),
  };
}

/** Xodim (staff) so'rovidan organization id; yo'q bo'lsa 403. Global guard `req.user` ni qo'yadi. */
export function requireStaffOrganizationId(req: { user?: { organization?: { id?: string } | null } }): string {
  const id = req.user?.organization?.id;
  if (!id) throw new ForbiddenException('User has no organization');
  return id;
}

/** Tarjimalar ichidan eng mosini tanlaydi: so'ralgan til → ru → uz → en → birinchisi. */
export function pickTranslation<T extends { lang: string }>(list: T[], lang: Lang): T | undefined {
  for (const l of [lang, 'ru', 'uz', 'en']) {
    const hit = list.find((t) => t.lang === l);
    if (hit) return hit;
  }
  return list[0];
}
