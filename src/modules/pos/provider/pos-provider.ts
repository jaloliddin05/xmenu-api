/**
 * A POS (cash register system) behind one interface: the integration code talks to it and never to
 * a vendor API directly. MVP has one adapter, iiko (../iiko/iiko.provider.ts); docs/IIKO.md.
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

/**
 * How the POS organization takes a delivery address (iiko addressFormatType). Only `city` takes a line
 * of text; every other format takes a street of the POS directory and a house.
 */
export type PosAddressFormat =
  | 'city'
  | 'legacy'
  | 'international'
  | 'int_no_postcode'
  | 'unknown';

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
  /** One size only: its POS id, passed with every order of the item (null: the item has no sizes) */
  defaultSizeId: string | null;
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
  /** DeliveryOrderUpdate / DeliveryOrderError: the order as iiko reports it */
  order: PosOrderInfo | null;
}

/** An order as Xmenu passes it to the POS (domain/pos-order-draft.ts builds it from an accepted order). */
export interface PosOrderDraft {
  /** The Xmenu order id: the POS creates no duplicate for a repeated id */
  id: string;
  externalNumber: string;
  terminalGroupId: string;
  /** Price category of the venue (the one the menu is imported in); null: the POS default */
  priceCategoryId: string | null;
  kind: 'delivery' | 'pickup';
  phone: string;
  customerName: string;
  comment: string | null;
  items: PosOrderLine[];
  payment: {
    paymentTypeId: string;
    paymentTypeKind: string;
    sum: number;
    /** Paid online before the POS got the order */
    processedExternally: boolean;
  };
  /** Delivery only */
  address: PosOrderAddress | null;
}

export interface PosOrderLine {
  productId: string;
  sizeId: string | null;
  amount: number;
  /** Price of one unit without modifiers */
  price: number;
  modifiers: {
    productId: string;
    groupId: string;
    amount: number;
    price: number;
  }[];
}

export type PosOrderAddress = {
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  flat: string | null;
  comment: string | null;
} & (
  | { format: 'city'; line: string }
  | { format: 'legacy'; streetId: string; house: string }
);

/** Delivery statuses of the POS (iiko DeliveryStatus). */
export type PosDeliveryStatus =
  | 'Unconfirmed'
  | 'WaitCooking'
  | 'ReadyForCooking'
  | 'CookingStarted'
  | 'CookingCompleted'
  | 'Waiting'
  | 'OnWay'
  | 'Delivered'
  | 'Closed'
  | 'Cancelled';

/** What the POS knows about one order. */
export interface PosOrderInfo {
  /** The Xmenu order id */
  id: string;
  creation: 'in_progress' | 'success' | 'error' | null;
  /** The POS error code of a failed creation (iiko errorInfo.code) */
  errorCode: string | null;
  status: PosDeliveryStatus | null;
  number: string | null;
  courierName: string | null;
}

/** Result of a POS command (create, confirm, delivery status). */
export type PosCommandState =
  | { state: 'in_progress' }
  | { state: 'success' }
  | { state: 'error'; errorCode: string | null }
  /** The POS no longer knows the command */
  | { state: 'unknown' };

export interface PosStreet {
  id: string;
  name: string;
  city: string;
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
  /** Sends an order; the result comes later through commandStatus or a webhook. */
  createOrder(
    cred: PosCredentials,
    orgId: string,
    order: PosOrderDraft,
  ): Promise<{ correlationId: string; info: PosOrderInfo | null }>;
  commandStatus(
    cred: PosCredentials,
    orgId: string,
    correlationId: string,
  ): Promise<PosCommandState>;
  /** Confirms an order that waits for confirmation in the POS; returns the command id. */
  confirmOrder(
    cred: PosCredentials,
    orgId: string,
    orderId: string,
  ): Promise<string>;
  /** Moves a delivery forward (own couriers of the venue); returns the command id. */
  setDeliveryStatus(
    cred: PosCredentials,
    orgId: string,
    orderId: string,
    status: 'OnWay' | 'Delivered',
  ): Promise<string>;
  /** Orders by Xmenu id; orders the POS does not know are left out. */
  orders(
    cred: PosCredentials,
    orgId: string,
    orderIds: string[],
  ): Promise<PosOrderInfo[]>;
  /** Every street of the POS directory with its city (kept for a day, pos-streets.cache.ts). */
  streets(cred: PosCredentials, orgId: string): Promise<PosStreet[]>;
}

export const POS_PROVIDER = Symbol('POS_PROVIDER');
