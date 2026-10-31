import { isValidSlug } from './slug';

/**
 * Channels and publication of a venue (docs/API.md, "Каналы и публикация").
 *
 * - QR menu: on by default, works right after signup; the flag is only reported to the QR front-end.
 * - Ordering ("delivery" channel): orders from the website and/or the Mini App, delivery and pickup alike.
 *   Off by default. Taking orders needs the channel on AND a publication: POST /publish checks the
 *   checklist below and sets published_at, POST /unpublish pauses (published_at = NULL), turning the
 *   channel off pauses too. Published always implies enabled.
 */
export const DELIVERY_MODES = ['site', 'miniapp', 'both'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export interface Channels {
  qr: boolean;
  delivery: { enabled: boolean; mode: DeliveryMode };
}

/** Modes served through the Mini App need the venue's own connected Telegram bot. */
export const modeNeedsBot = (mode: DeliveryMode) => mode !== 'site';

export interface BranchFacts {
  /** At least one weekday with working hours (24h counts, closed days do not). */
  hasHours: boolean;
  /** Coordinates set: (0, 0) is what an empty map pin gives, not a real venue. */
  hasCoordinates: boolean;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
}

/** What the checklist looks at; read fresh from the database (publication.service.ts). */
export interface PublicationFacts {
  name: string;
  slug: string | null;
  deliveryEnabled: boolean;
  deliveryMode: DeliveryMode;
  hasActiveCategory: boolean;
  /** An active dish inside an active category (what the menu actually shows). */
  hasActiveProduct: boolean;
  /** Active branches only. */
  branches: BranchFacts[];
  hasDeliveryZone: boolean;
  /** The venue's bot is connected and enabled (organization_telegram_bot.is_enabled). */
  botConnected: boolean;
}

export const CHECKLIST_IDS = [
  'delivery_channel',
  'venue_name',
  'venue_slug',
  'menu_category',
  'menu_product',
  'branch',
  'delivery_zone',
  'telegram_bot',
] as const;
export type ChecklistId = (typeof CHECKLIST_IDS)[number];

export const CHECKLIST_STATUSES = ['done', 'todo', 'not_required'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export interface ChecklistItem {
  id: ChecklistId;
  status: ChecklistStatus;
  /** What to fix, in Russian (the dashboard language); null unless status is todo. */
  hint: string | null;
}

const done = (id: ChecklistId): ChecklistItem => ({
  id,
  status: 'done',
  hint: null,
});
const notRequired = (id: ChecklistId): ChecklistItem => ({
  id,
  status: 'not_required',
  hint: null,
});
const todo = (id: ChecklistId, hint: string): ChecklistItem => ({
  id,
  status: 'todo',
  hint,
});
const check = (id: ChecklistId, ok: boolean, hint: string) =>
  ok ? done(id) : todo(id, hint);

/** A branch that can take orders: hours, a map point and at least one fulfillment mode, all on one branch. */
const isReadyBranch = (b: BranchFacts) =>
  b.hasHours && b.hasCoordinates && (b.acceptsPickup || b.acceptsDelivery);

function branchItem(branches: BranchFacts[]): ChecklistItem {
  if (branches.some(isReadyBranch)) return done('branch');
  if (branches.length === 0)
    return todo(
      'branch',
      'Добавьте филиал: адрес, точка на карте и часы работы',
    );
  const missing: string[] = [];
  if (!branches.some((b) => b.hasHours))
    missing.push('часы работы (или «круглосуточно»)');
  if (!branches.some((b) => b.hasCoordinates)) missing.push('точку на карте');
  if (!branches.some((b) => b.acceptsPickup || b.acceptsDelivery))
    missing.push('самовывоз или доставку');
  const hint = missing.length
    ? `Укажите у филиала ${missing.join(', ')}`
    : 'Нужен один филиал, у которого есть сразу часы работы, точка на карте и самовывоз или доставка';
  return todo('branch', hint);
}

/** Every item, in CHECKLIST_IDS order. Logo, colors, contacts and payment keys never block publication. */
export function evaluateChecklist(f: PublicationFacts): ChecklistItem[] {
  const deliversSomewhere = f.branches.some((b) => b.acceptsDelivery);
  return [
    check('delivery_channel', f.deliveryEnabled, 'Включите канал доставки'),
    check('venue_name', f.name.trim().length > 0, 'Укажите название заведения'),
    check('venue_slug', isValidSlug(f.slug), 'Укажите адрес заведения (slug)'),
    check(
      'menu_category',
      f.hasActiveCategory,
      'Добавьте в меню хотя бы одну активную категорию',
    ),
    check(
      'menu_product',
      f.hasActiveProduct,
      'Добавьте хотя бы одно активное блюдо в активную категорию',
    ),
    branchItem(f.branches),
    deliversSomewhere
      ? check(
          'delivery_zone',
          f.hasDeliveryZone,
          'Нарисуйте зону доставки или отключите доставку в филиалах',
        )
      : notRequired('delivery_zone'),
    modeNeedsBot(f.deliveryMode)
      ? check(
          'telegram_bot',
          f.botConnected,
          'Подключите Telegram-бота или выберите режим «сайт»',
        )
      : notRequired('telegram_bot'),
  ];
}

export const isReady = (items: ChecklistItem[]) =>
  items.every((i) => i.status !== 'todo');

export type OrderingProblem =
  | 'ordering_channel_disabled'
  | 'ordering_not_published';

/** Why a customer cannot order right now (POST /orders), or null. Applies to delivery and pickup. */
export function orderingProblem(state: {
  deliveryEnabled: boolean;
  publishedAt: Date | null;
}): OrderingProblem | null {
  if (!state.deliveryEnabled) return 'ordering_channel_disabled';
  if (!state.publishedAt) return 'ordering_not_published';
  return null;
}

/** Customers can order right now (GET /tenant/config fulfillment, channels.delivery). */
export const orderingOpen = (state: {
  deliveryEnabled: boolean;
  publishedAt: Date | null;
}) => orderingProblem(state) === null;
