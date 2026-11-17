/**
 * A POS (cash register system) behind one interface: the integration code talks to it and never to
 * a vendor API directly. MVP has one adapter, iiko (../iiko/iiko.provider.ts). Order sending and
 * statuses join the interface in part 2 (../docs/IIKO.md).
 *
 * Every method takes the restaurant's own credentials: adapters keep no state per venue except a
 * short-lived access token cache.
 */
export interface PosCredentials {
  /** Cache key of the access token: the integration id */
  integrationId: string;
  apiKey: string;
}

export interface PosOrganization {
  id: string;
  name: string;
}

export type PosAddressFormat = 'city' | 'legacy' | 'unknown';

export interface PosTerminalGroup {
  id: string;
  name: string;
}

export interface PosPaymentType {
  id: string;
  name: string;
  kind: string;
}

export interface PosNamed {
  id: string;
  name: string;
}

export interface PosDictionaries {
  terminalGroups: PosTerminalGroup[];
  paymentTypes: PosPaymentType[];
  externalMenus: PosNamed[];
  priceCategories: PosNamed[];
}

export type PosCheckKey = 'delivery_module' | 'key_access' | 'terminal_alive';
export type PosCheckStatus = 'ok' | 'fail' | 'unknown';

export interface PosCheck {
  key: PosCheckKey;
  status: PosCheckStatus;
  /** terminal_alive: one entry per linked branch */
  branchId?: string;
  /** Error code of a failed check (pos_module_missing, pos_access_denied, ...) */
  code?: string;
}

/** Normalized menu: what Xmenu imports, whatever the vendor format. */
export interface PosMenu {
  categories: PosMenuCategory[];
  items: PosMenuItem[];
}

export interface PosMenuCategory {
  externalId: string;
  name: string;
  hidden: boolean;
}

export interface PosMenuItem {
  /** The POS id the order uses (iiko productId) */
  externalId: string;
  categoryExternalId: string;
  name: string;
  description: string | null;
  /** Hidden in the POS, not for sale at this price category, or no visible size */
  hidden: boolean;
  sortOrder: number;
  /** Price of the cheapest visible size (the price of the dish when it has one size) */
  price: number;
  /** Two or more visible sizes: imported as a required "size" option group */
  sizes: PosMenuSize[];
  modifierGroups: PosModifierGroup[];
  weight: number | null;
  unit: 'gr' | 'ml';
  nutrition: {
    protein: number | null;
    fat: number | null;
    carbohydrate: number | null;
    kcal: number | null;
  };
  imageUrl: string | null;
  /** The POS takes a price set by the order (iiko canSetOpenPrice) */
  openPrice: boolean;
}

export interface PosMenuSize {
  sizeId: string;
  name: string;
  /** Full price of the dish in this size */
  price: number;
  isDefault: boolean;
}

export interface PosModifierGroup {
  /** Unique within the item */
  externalId: string;
  name: string;
  min: number;
  max: number;
  options: PosModifier[];
}

export interface PosModifier {
  externalId: string;
  name: string;
  price: number;
}

/** Stop list of one terminal group: POS item ids that cannot be sold now. */
export interface PosStopList {
  terminalGroupId: string;
  items: { externalId: string; sizeId: string | null; balance: number }[];
}

export interface PosWebhookEvent {
  /** Dedup key: the same event delivered twice has the same key */
  key: string;
  type: string;
  externalOrgId: string | null;
  /** StopListUpdate: the terminal groups whose stop list changed */
  terminalGroupIds: string[];
}

export interface PosProvider {
  /** Gets an access token: throws pos_key_invalid, pos_access_denied, pos_unavailable. */
  verifyKey(cred: PosCredentials): Promise<void>;
  listOrganizations(cred: PosCredentials): Promise<PosOrganization[]>;
  addressFormat(cred: PosCredentials, orgId: string): Promise<PosAddressFormat>;
  dictionaries(cred: PosCredentials, orgId: string): Promise<PosDictionaries>;
  /** Terminal group id → its cash desk is online; groups iiko did not report are left out. */
  terminalsAlive(
    cred: PosCredentials,
    orgId: string,
    terminalGroupIds: string[],
  ): Promise<Map<string, boolean>>;
  /** Delivery module and key rights for the organization, cash desks of the given terminal groups. */
  checks(
    cred: PosCredentials,
    orgId: string,
    terminals: { branchId: string; terminalGroupId: string }[],
  ): Promise<PosCheck[]>;
  /** The external menu for one price category; throws pos_external_menu_missing if it is gone. */
  fetchMenu(
    cred: PosCredentials,
    orgId: string,
    menuId: string,
    priceCategoryId: string | null,
  ): Promise<PosMenu>;
  fetchStopLists(
    cred: PosCredentials,
    orgId: string,
    terminalGroupIds: string[],
  ): Promise<PosStopList[]>;
  setWebhook(
    cred: PosCredentials,
    orgId: string,
    url: string,
    authToken: string,
  ): Promise<void>;
  clearWebhook(cred: PosCredentials, orgId: string): Promise<void>;
  /** Events of one webhook call; unknown shapes are skipped. */
  parseWebhook(body: unknown): PosWebhookEvent[];
}

export const POS_PROVIDER = Symbol('POS_PROVIDER');
