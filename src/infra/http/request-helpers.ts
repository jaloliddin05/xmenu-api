import { ForbiddenException } from '@nestjs/common';

export const LANGS = ['ru', 'uz', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * ?lang=uz or Accept-Language: uz-UZ,ru;q=0.8 → the first requested language the tenant offers;
 * otherwise the tenant's default language (organization_settings).
 */
export function resolveLang(
  req: { query?: Record<string, any>; headers?: Record<string, any> },
  tenant: { languages: readonly Lang[]; defaultLanguage: Lang },
): Lang {
  const pick = (v: unknown): Lang | null => {
    const code = typeof v === 'string' ? v.trim().toLowerCase().slice(0, 2) : '';
    return isLang(code) && tenant.languages.includes(code) ? code : null;
  };
  const fromQuery = pick(req.query?.lang);
  if (fromQuery) return fromQuery;

  const header = String(req.headers?.['accept-language'] ?? '');
  for (const part of header.split(',')) {
    const lang = pick(part.split(';')[0]);
    if (lang) return lang;
  }
  return tenant.defaultLanguage;
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

/** Best translation: the requested language → the tenant's default language → the first one. */
export function pickTranslation<T extends { lang: string }>(list: T[], lang: Lang, fallback: Lang): T | undefined {
  return list.find((t) => t.lang === lang) ?? list.find((t) => t.lang === fallback) ?? list[0];
}
