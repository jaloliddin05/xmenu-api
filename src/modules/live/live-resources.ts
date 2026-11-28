import type { RevalidateRoute } from 'src/modules/revalidate-queue/revalidate-job';

/**
 * What a staff change touches, by the first segment of the route path. Every staff route that changes data
 * (POST, PUT, PATCH, DELETE) must resolve here: live-resources.spec.ts walks all routes and fails on a missing one,
 * so no screen is left without its event. `null`: the change is not shown on any other screen (login, push
 * subscriptions, uploads before they are saved, translation suggestions).
 */
export const STAFF_RESOURCES: Record<string, string | null> = {
  'additional-product': 'menu',
  category: 'menu',
  product: 'menu',
  branch: 'branches',
  couriers: 'couriers',
  shifts: 'couriers',
  'external-services': 'couriers',
  order: 'orders',
  'order-settings': 'settings',
  organization: 'venue',
  'payment-provider': 'settings',
  integrations: 'pos',
  'telegram-bot': 'settings',
  staff: 'staff',
  user: 'account',
  auth: null,
  push: null,
  file: null,
  translation: null,
};

/** The resource of a route path (`/organization/:id/settings` → `venue`); undefined when it is not listed. */
export function resourceOf(path: string): string | null | undefined {
  const first = path.split('/').filter(Boolean)[0] ?? '';
  return first in STAFF_RESOURCES ? STAFF_RESOURCES[first] : undefined;
}

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Resources guests see: a change refreshes the cached guest pages (QR menu, delivery site) even if the service
 * forgot to, and open guest pages hear content.changed after that (revalidate.processor.ts).
 */
export const PUBLIC_RESOURCES: Record<string, RevalidateRoute> = {
  menu: 'menu',
  branches: 'branches',
  venue: 'organization',
  settings: 'settings',
  pos: 'menu',
};
