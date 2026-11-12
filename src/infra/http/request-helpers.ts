import { AppException } from 'src/infra/errors/app-exception';

export const LANGS = ['ru', 'uz', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return (
    typeof value === 'string' && (LANGS as readonly string[]).includes(value)
  );
}

/**
 * ?lang=uz, else Accept-Language: uz-UZ,ru;q=0.8 → the requested language with the highest q the
 * tenant offers (equal q: the earlier one; q=0: not wanted); otherwise the tenant's default language
 * (organization_settings).
 */
export function resolveLang(
  req: { query?: Record<string, any>; headers?: Record<string, any> },
  tenant: { languages: readonly Lang[]; defaultLanguage: Lang },
): Lang {
  const pick = (v: unknown): Lang | null => {
    const code =
      typeof v === 'string' ? v.trim().toLowerCase().slice(0, 2) : '';
    return isLang(code) && tenant.languages.includes(code) ? code : null;
  };
  const fromQuery = pick(req.query?.lang);
  if (fromQuery) return fromQuery;

  for (const tag of acceptedLanguages(
    String(req.headers?.['accept-language'] ?? ''),
  )) {
    const lang = pick(tag);
    if (lang) return lang;
  }
  return tenant.defaultLanguage;
}

/** Language tags of an Accept-Language header by q (highest first, stable), without q=0 ones. */
export function acceptedLanguages(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.split(';');
      const qParam = params
        .map((p) => p.trim().toLowerCase())
        .find((p) => p.startsWith('q='));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((l) => l.tag && l.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((l) => l.tag);
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
export function requireStaffOrganizationId(req: {
  user?: { organization?: { id?: string } | null };
}): string {
  const id = req.user?.organization?.id;
  if (!id)
    throw new AppException('forbidden', {
      message: 'User has no organization',
    });
  return id;
}

/** Best translation: the requested language → the tenant's default language → the first one. */
export function pickTranslation<T extends { lang: string }>(
  list: T[],
  lang: Lang,
  fallback: Lang,
): T | undefined {
  return (
    list.find((t) => t.lang === lang) ??
    list.find((t) => t.lang === fallback) ??
    list[0]
  );
}

/** Staff request that came with an access token: `sid` is the login (session) it belongs to. */
export interface StaffSessionRequest {
  user: StaffRequest['user'] & { sid: string };
}

/** The request as seen by staff routes: the global guard puts the staff user on `req.user`. */
export interface StaffRequest {
  user: {
    id: string;
    // requireStaffOrganizationId() runs first and rejects staff without an organization (403)
    organization: { id: string; slug: string };
  };
}
