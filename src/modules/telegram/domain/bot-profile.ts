import { isLang, Lang } from 'src/infra/http/request-helpers';
import type { FieldError } from 'src/infra/validators/validation-errors';

/** What the owner edits per language (and what is pushed to the venue's bot). */
export interface BotProfileFields {
  /** Bot name (setMyName) */
  name: string;
  /** Long description shown on the empty chat screen (setMyDescription) */
  description: string;
  /** Short description shown on the bot's profile and in shares (setMyShortDescription) */
  shortDescription: string;
  /** Text of the menu button that opens the Mini App */
  menuButtonText: string;
}

export type BotProfile = Partial<Record<Lang, BotProfileFields>>;

/** Telegram limits (Bot API: setMyName, setMyDescription, setMyShortDescription). */
export const BOT_PROFILE_LIMITS: Record<keyof BotProfileFields, number> = {
  name: 64,
  description: 512,
  shortDescription: 120,
  menuButtonText: 32,
};

export const BOT_PROFILE_FIELDS = Object.keys(
  BOT_PROFILE_LIMITS,
) as (keyof BotProfileFields)[];

const MENU_BUTTON_TEXT: Record<Lang, string> = {
  ru: 'Меню',
  uz: 'Menyu',
  en: 'Menu',
};

/** Used when the venue has no description in that language (or any other). */
const FALLBACK_DESCRIPTION: Record<Lang, (name: string) => string> = {
  ru: (name) => `Меню и заказ еды из «${name}».`,
  uz: (name) => `«${name}» menyusi va ovqat buyurtma qilish.`,
  en: (name) => `Menu and food ordering from “${name}”.`,
};

export const BOT_START_COMMAND: Record<Lang, string> = {
  ru: 'Открыть меню',
  uz: 'Menyuni ochish',
  en: 'Open menu',
};

/** Cuts at `max` characters without splitting a surrogate pair. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

export interface VenueFacts {
  name: string;
  /** description per language, as stored in organization_translation */
  descriptions: Partial<Record<string, string>>;
  defaultLanguage: Lang;
}

/** Profile derived from the venue's own data, used until the owner edits it. */
export function defaultProfileFor(
  lang: Lang,
  venue: VenueFacts,
): BotProfileFields {
  const description =
    venue.descriptions[lang]?.trim() ||
    venue.descriptions[venue.defaultLanguage]?.trim() ||
    FALLBACK_DESCRIPTION[lang](venue.name);
  return {
    name: truncate(venue.name, BOT_PROFILE_LIMITS.name),
    description: truncate(description, BOT_PROFILE_LIMITS.description),
    shortDescription: truncate(
      description,
      BOT_PROFILE_LIMITS.shortDescription,
    ),
    menuButtonText: MENU_BUTTON_TEXT[lang],
  };
}

/** One entry per venue language: stored fields win, missing ones come from the defaults. */
export function resolveProfile(
  stored: unknown,
  languages: Lang[],
  venue: VenueFacts,
): Record<Lang, BotProfileFields> {
  const saved =
    stored && typeof stored === 'object'
      ? (stored as Record<string, Partial<BotProfileFields> | undefined>)
      : {};
  const out = {} as Record<Lang, BotProfileFields>;
  for (const lang of languages) {
    const defaults = defaultProfileFor(lang, venue);
    const own = saved[lang] ?? {};
    out[lang] = Object.fromEntries(
      BOT_PROFILE_FIELDS.map((field) => [
        field,
        typeof own[field] === 'string' ? own[field] : defaults[field],
      ]),
    ) as unknown as BotProfileFields;
  }
  return out;
}

/**
 * Checks the owner's input: only the venue's languages, every field a string within Telegram's
 * limits, name / short description / button text not empty. Returns the clean profile or the
 * list of problems (field paths like `ru.name`).
 */
export function validateProfileInput(
  input: unknown,
  languages: Lang[],
): { profile: BotProfile } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const profile: BotProfile = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      errors: [
        {
          field: 'profile',
          reason: 'isObject',
          message: 'profile must be an object',
        },
      ],
    };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  for (const [lang, value] of entries) {
    if (!isLang(lang) || !languages.includes(lang)) {
      errors.push({
        field: lang,
        reason: 'notInLanguages',
        message: 'language is not enabled for this venue',
      });
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({
        field: lang,
        reason: 'isObject',
        message: 'must be an object',
      });
      continue;
    }
    const fields = value as Record<string, unknown>;
    const clean = {} as BotProfileFields;
    for (const key of Object.keys(fields)) {
      if (!(key in BOT_PROFILE_LIMITS)) {
        errors.push({
          field: `${lang}.${key}`,
          reason: 'whitelistValidation',
          message: `property ${key} should not exist`,
        });
      }
    }
    for (const field of BOT_PROFILE_FIELDS) {
      const raw = fields[field];
      const path = `${lang}.${field}`;
      if (typeof raw !== 'string') {
        errors.push({
          field: path,
          reason: 'isString',
          message: `${field} must be a string`,
        });
        continue;
      }
      const text = raw.trim();
      const max = BOT_PROFILE_LIMITS[field];
      if (Array.from(text).length > max) {
        errors.push({
          field: path,
          reason: 'maxLength',
          message: `${field} must be at most ${max} characters`,
        });
      } else if (!text && field !== 'description') {
        errors.push({
          field: path,
          reason: 'isNotEmpty',
          message: `${field} must not be empty`,
        });
      }
      clean[field] = text;
    }
    profile[lang] = clean;
  }
  return errors.length ? { errors } : { profile };
}

export type SyncStatus = 'ok' | 'failed' | 'skipped_no_url';
export interface SyncItem {
  status: SyncStatus;
  reason?: string;
}
export const SYNC_ITEMS = [
  'name',
  'description',
  'shortDescription',
  'commands',
  'menuButton',
] as const;
export type SyncResult = Record<(typeof SYNC_ITEMS)[number], SyncItem>;

/** Mini App address of a venue from DELIVERY_URL_TEMPLATE ("https://{slug}.xmenu.uz"), or null. */
export function deliveryUrl(
  slug: string | null | undefined,
  template: string | undefined = process.env.DELIVERY_URL_TEMPLATE,
): string | null {
  if (!slug || !template || !template.includes('{slug}')) return null;
  const url = template.replaceAll('{slug}', slug);
  return url.startsWith('https://') ? url : null;
}
