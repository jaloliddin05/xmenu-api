import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import type { FieldError } from 'src/infra/errors/app-exception';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { errorMessage } from 'src/infra/helper/error-text';
import { hashWebhookSecret } from 'src/infra/http/webhook-secret';
import { LIVE_STATUSES } from 'src/modules/order/domain/order-state-machine';
import {
  isPosLive,
  missingForEnable,
  requiredPaymentMethods,
  stepStatus,
} from '../domain/pos-steps';
import {
  IikoApiClient,
  iikoErrorText,
  toAppException,
} from '../iiko/iiko-api.client';
import { POS_PROVIDER, PosCheck } from '../provider/pos-provider';
import type { PosProvider } from '../provider/pos-provider';
import type {
  PosDictionariesDto,
  PosLinksDto,
  PosMatchDto,
  PosStatusDto,
} from '../dto/pos-iiko.dto';
import { PosAlertService } from './pos-alert.service';
import { PosKeyring } from './pos-keyring';
import {
  isPosLockTimeout,
  lockPosIntegration,
  POS_LOCK_WAIT_MS,
} from './pos-lock';
import { PosMenuImportService } from './pos-menu-import.service';
import { PosStopListService } from './pos-stop-list.service';
import { PosSyncQueue } from './pos-sync.queue';

const INCLUDE = {
  branch_links: { orderBy: { branch_id: 'asc' } },
  payment_links: { orderBy: { method: 'asc' } },
} satisfies Prisma.pos_integrationInclude;

type Row = Prisma.pos_integrationGetPayload<{ include: typeof INCLUDE }>;

const publicApiUrl = () =>
  (process.env.PUBLIC_API_URL ?? '').trim().replace(/\/$/, '');

/** Address iiko calls: keyed by the integration id, never the slug. Logged only, never returned. */
export const posWebhookUrl = (integrationId: string) =>
  `${publicApiUrl()}/pos/iiko/${integrationId}/webhook`;

/** A disconnected integration connected again: back to the first steps */
const FRESH_DRAFT = {
  status: 'draft',
  external_org_id: null,
  address_format: null,
  external_menu_id: null,
  price_category_id: null,
  delivery_item_id: null,
  delivery_size_id: null,
  courier_mode: 'xmenu',
  source_lang: null,
  webhook_secret_hash: null,
  checks: Prisma.DbNull,
  checked_at: null,
  menu_imported_at: null,
  menu_import_error: null,
  stop_list_updated_at: null,
  enabled_at: null,
  disconnected_at: null,
  alert: null,
  alert_at: null,
} satisfies Prisma.pos_integrationUpdateInput;

const notConnected = () =>
  new AppException('pos_not_connected', {
    message: 'Enter the POS key first',
  });

/**
 * Connecting a venue to iiko step by step (docs/IIKO.md, "Подключение заведения"): key →
 * organization → branches → payments and the "Delivery" item → menu → enable. Owner only
 * (StaffAccess 'venue'); the organization always comes from the token.
 */
@Injectable()
export class PosIntegrationService {
  private readonly logger = new Logger('PosIntegration');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    private readonly api: IikoApiClient,
    private readonly keyring: PosKeyring,
    private readonly menu: PosMenuImportService,
    private readonly stopList: PosStopListService,
    private readonly sync: PosSyncQueue,
    private readonly revalidate: RevalidateService,
    private readonly alerts: PosAlertService,
  ) {}

  /** The platform has the integrator application and can keep keys: otherwise 503 platform_misconfigured (pos). */
  private assertConfigured(): void {
    if (
      !process.env.IIKO_APP_ID?.trim() ||
      !process.env.IIKO_CLIENT_SECRET?.trim()
    )
      throw platformMisconfigured(
        'pos',
        'IIKO_APP_ID or IIKO_CLIENT_SECRET is not set',
      );
    this.keyring.encrypt('probe');
  }

  /** GET answers `available: false` instead of letting the owner find out after typing the key. */
  private available(): boolean {
    try {
      this.assertConfigured();
      return true;
    } catch {
      return false;
    }
  }

  private async row(orgId: string): Promise<Row | null> {
    return this.prisma.pos_integration.findUnique({
      where: { organization_id: orgId },
      include: INCLUDE,
    });
  }

  private async requireRow(orgId: string): Promise<Row> {
    const row = await this.row(orgId);
    if (!row || row.status === 'disconnected') throw notConnected();
    return row;
  }

  private requireOrg(row: Row): string {
    if (!row.external_org_id)
      throw new AppException('pos_not_connected', {
        message: 'Choose the POS organization first',
      });
    return row.external_org_id;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toAppException(e);
    }
  }

  private async stepsOf(row: Row) {
    const settings = await this.prisma.organization_order_settings.findUnique({
      where: { organization_id: row.organization_id },
      select: { delivery_pay_card: true, delivery_pay_online: true },
    });
    if (!settings)
      throw new AppException('settings_missing', {
        cause: `organization_order_settings of ${row.organization_id} is missing`,
      });
    return stepStatus({
      externalOrgId: row.external_org_id,
      addressFormat: row.address_format,
      branchLinks: row.branch_links.length,
      paymentMethods: row.payment_links.map((p) => p.method),
      requiredPaymentMethods: requiredPaymentMethods(settings),
      deliveryItemId: row.delivery_item_id,
      externalMenuId: row.external_menu_id,
    });
  }

  private async view(row: Row | null): Promise<PosStatusDto> {
    const available = this.available();
    if (!row || row.status === 'disconnected')
      return {
        available,
        connected: false,
        status: null,
        alert: null,
        steps: null,
        externalOrgId: null,
        addressFormat: null,
        courierMode: 'xmenu',
        externalMenuId: null,
        priceCategoryId: null,
        deliveryItem: null,
        branches: [],
        payments: [],
        checks: [],
        checkedAt: null,
        menuImportedAt: null,
        menuImportError: null,
        stopListUpdatedAt: null,
        enabledAt: null,
      };
    return {
      available,
      connected: true,
      status: row.status,
      alert:
        row.alert && row.alert_at
          ? { code: row.alert, at: row.alert_at }
          : null,
      steps: await this.stepsOf(row),
      externalOrgId: row.external_org_id,
      addressFormat: row.address_format,
      courierMode: row.courier_mode,
      externalMenuId: row.external_menu_id,
      priceCategoryId: row.price_category_id,
      deliveryItem: row.delivery_item_id
        ? { itemId: row.delivery_item_id, sizeId: row.delivery_size_id }
        : null,
      branches: row.branch_links.map((b) => ({
        branchId: b.branch_id,
        terminalGroupId: b.terminal_group_id,
        priceCategoryId: b.price_category_id,
      })),
      payments: row.payment_links.map((p) => ({
        method: p.method,
        paymentTypeId: p.payment_type_id,
        paymentTypeKind: p.payment_type_kind,
      })),
      checks: (row.checks as PosCheck[] | null) ?? [],
      checkedAt: row.checked_at,
      menuImportedAt: row.menu_imported_at,
      menuImportError: row.menu_import_error,
      stopListUpdatedAt: row.stop_list_updated_at,
      enabledAt: row.enabled_at,
    };
  }

  async status(orgId: string): Promise<PosStatusDto> {
    return this.view(await this.row(orgId));
  }

  /**
   * Step 1: the key is checked by getting a token with it, then stored encrypted. A venue with one
   * iiko organization gets it chosen at once. A reconnect with a working key reactivates the
   * integration.
   */
  async setKey(orgId: string, apiKey: string) {
    this.assertConfigured();
    const existing = await this.row(orgId);
    const id = existing?.id ?? randomUUID();
    const cred = { integrationId: id, apiKey: apiKey.trim() };
    await this.call(() => this.provider.verifyKey(cred));
    const organizations = await this.call(() =>
      this.provider.listOrganizations(cred),
    );
    const encrypted = this.keyring.encrypt(cred.apiKey);
    const restart = existing?.status === 'disconnected';
    await this.prisma.pos_integration.upsert({
      where: { organization_id: orgId },
      create: { id, organization_id: orgId, api_key_encrypted: encrypted },
      update: {
        api_key_encrypted: encrypted,
        ...(existing?.status === 'needs_reconnect' ? { status: 'active' } : {}),
        // Connecting again after disconnecting: the steps start over (orders sent before stay)
        ...(restart ? FRESH_DRAFT : {}),
      },
    });
    await this.alerts.clear(id, 'key_revoked');
    const sole =
      organizations.length === 1 && (restart || !existing?.external_org_id)
        ? organizations[0].id
        : null;
    if (sole) await this.setOrganization(orgId, sole);
    return { organizations, ...(await this.status(orgId)) };
  }

  async organizations(orgId: string) {
    const row = await this.requireRow(orgId);
    const cred = this.keyring.credentials(row);
    return {
      organizations: await this.call(() =>
        this.provider.listOrganizations(cred),
      ),
    };
  }

  /** Step 2: the iiko organization; its address format is read at once. */
  async setOrganization(orgId: string, externalOrgId: string) {
    const row = await this.requireRow(orgId);
    if (row.status !== 'draft' && row.external_org_id !== externalOrgId)
      throw fieldErrorsException('pos_links_invalid', [
        {
          field: 'externalOrgId',
          code: 'disconnect_first',
          message: 'The organization of an enabled integration cannot change',
        },
      ]);
    const cred = this.keyring.credentials(row);
    const list = await this.call(() => this.provider.listOrganizations(cred));
    if (!list.some((o) => o.id === externalOrgId))
      throw fieldErrorsException('pos_links_invalid', [
        {
          field: 'externalOrgId',
          code: 'unknown_organization',
          message: 'The key has no such organization',
        },
      ]);
    const format = await this.call(() =>
      this.provider.addressFormat(cred, externalOrgId),
    );
    const changed = row.external_org_id !== externalOrgId;
    await this.prisma.$transaction(async (tx) => {
      if (changed) {
        // Links point into the previous organization
        await tx.pos_branch_link.deleteMany({
          where: { integration_id: row.id },
        });
        await tx.pos_payment_link.deleteMany({
          where: { integration_id: row.id },
        });
      }
      await tx.pos_integration.update({
        where: { id: row.id },
        data: {
          external_org_id: externalOrgId,
          address_format: format,
          ...(changed
            ? {
                external_menu_id: null,
                price_category_id: null,
                delivery_item_id: null,
                delivery_size_id: null,
                checks: Prisma.DbNull,
                checked_at: null,
              }
            : {}),
        },
      });
    });
    return this.status(orgId);
  }

  async dictionaries(orgId: string): Promise<PosDictionariesDto> {
    const row = await this.requireRow(orgId);
    const externalOrgId = this.requireOrg(row);
    const cred = this.keyring.credentials(row);
    const dict = await this.call(() =>
      this.provider.dictionaries(cred, externalOrgId),
    );
    const alive = await this.aliveMap(
      row,
      dict.terminalGroups.map((t) => t.id),
    );
    const menuChosen =
      row.external_menu_id &&
      dict.externalMenus.some((m) => m.id === row.external_menu_id);
    const items = menuChosen
      ? (
          await this.call(() =>
            this.provider.fetchMenu(
              cred,
              externalOrgId,
              row.external_menu_id!,
              row.price_category_id,
            ),
          )
        ).items
      : [];
    return {
      terminalGroups: dict.terminalGroups.map((t) => ({
        ...t,
        isAlive: alive.get(t.id) ?? null,
      })),
      paymentTypes: dict.paymentTypes,
      externalMenus: dict.externalMenus,
      priceCategories: dict.priceCategories,
      serviceItems: items.map((i) => ({
        itemId: i.externalId,
        name: i.name,
        sizes: i.sizes.map((s) => ({ id: s.sizeId, name: s.name })),
        openPrice: i.openPrice,
      })),
    };
  }

  private async aliveMap(row: Row, terminalGroupIds: string[]) {
    return this.provider
      .terminalsAlive(
        this.keyring.credentials(row),
        row.external_org_id!,
        terminalGroupIds,
      )
      .catch(() => new Map<string, boolean>());
  }

  /**
   * Steps 3–5 in one document (PUT replaces all links): checked against the iiko dictionaries. Each
   * branch may have its own price category (decision 4 b); it goes into the orders of the branch,
   * the menu prices are imported in the integration's one.
   */
  async setLinks(orgId: string, dto: PosLinksDto) {
    const row = await this.requireRow(orgId);
    const externalOrgId = this.requireOrg(row);
    const cred = this.keyring.credentials(row);
    const dict = await this.call(() =>
      this.provider.dictionaries(cred, externalOrgId),
    );
    const problems: FieldError[] = [];
    const bad = (field: string, code: string, message: string) =>
      problems.push({ field, code, message });

    if (!dict.externalMenus.some((m) => m.id === dto.externalMenuId))
      throw new AppException('pos_external_menu_missing', {
        cause: 'the chosen external menu is not in iiko',
      });
    const category = dto.priceCategoryId ?? null;
    const knownCategory = (id: string) =>
      dict.priceCategories.some((c) => c.id === id);
    if (category && !knownCategory(category))
      bad(
        'priceCategoryId',
        'unknown_price_category',
        'No such price category',
      );

    const branchIds = dto.branches.map((b) => b.branchId);
    const own = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, organization_id: orgId },
      select: { id: true },
    });
    if (own.length !== new Set(branchIds).size)
      throw new AppException('not_found', { message: 'Branch not found' });
    const terminals = new Set(dict.terminalGroups.map((t) => t.id));
    const seenBranches = new Set<string>();
    dto.branches.forEach((b, i) => {
      if (seenBranches.has(b.branchId))
        bad(`branches[${i}].branchId`, 'duplicate', 'Branch listed twice');
      seenBranches.add(b.branchId);
      if (!terminals.has(b.terminalGroupId))
        bad(
          `branches[${i}].terminalGroupId`,
          'unknown_terminal_group',
          'No such terminal group',
        );
      if (b.priceCategoryId && !knownCategory(b.priceCategoryId))
        bad(
          `branches[${i}].priceCategoryId`,
          'unknown_price_category',
          'No such price category',
        );
    });

    const types = new Map(dict.paymentTypes.map((p) => [p.id, p]));
    const seenMethods = new Set<string>();
    dto.payments.forEach((p, i) => {
      if (seenMethods.has(p.method))
        bad(`payments[${i}].method`, 'duplicate', 'Method listed twice');
      seenMethods.add(p.method);
      if (!types.has(p.paymentTypeId))
        bad(
          `payments[${i}].paymentTypeId`,
          'unknown_payment_type',
          'No such payment type',
        );
    });

    if (dto.deliveryItem) {
      const items = (
        await this.call(() =>
          this.provider.fetchMenu(
            cred,
            externalOrgId,
            dto.externalMenuId,
            category,
          ),
        )
      ).items;
      const item = items.find((i) => i.externalId === dto.deliveryItem!.itemId);
      const sizeId = dto.deliveryItem.sizeId ?? null;
      if (!item)
        bad('deliveryItem.itemId', 'unknown_item', 'No such item in the menu');
      else if (
        (item.sizes.length > 0 && !sizeId) ||
        (sizeId && !item.sizes.some((s) => s.sizeId === sizeId))
      )
        bad('deliveryItem.sizeId', 'unknown_size', 'Choose a size of the item');
    }
    if (problems.length)
      throw fieldErrorsException('pos_links_invalid', problems);

    const menuChanged =
      row.external_menu_id !== dto.externalMenuId ||
      row.price_category_id !== category ||
      row.delivery_item_id !== (dto.deliveryItem?.itemId ?? null);
    await this.prisma.$transaction(async (tx) => {
      await tx.pos_branch_link.deleteMany({
        where: { integration_id: row.id },
      });
      await tx.pos_branch_link.createMany({
        data: dto.branches.map((b) => ({
          integration_id: row.id,
          branch_id: b.branchId,
          terminal_group_id: b.terminalGroupId,
          price_category_id: b.priceCategoryId ?? null,
        })),
      });
      await tx.pos_payment_link.deleteMany({
        where: { integration_id: row.id },
      });
      await tx.pos_payment_link.createMany({
        data: dto.payments.map((p) => ({
          integration_id: row.id,
          method: p.method,
          payment_type_id: p.paymentTypeId,
          payment_type_kind: types.get(p.paymentTypeId)!.kind,
        })),
      });
      await tx.pos_integration.update({
        where: { id: row.id },
        data: {
          external_menu_id: dto.externalMenuId,
          price_category_id: category,
          delivery_item_id: dto.deliveryItem?.itemId ?? null,
          delivery_size_id: dto.deliveryItem?.sizeId ?? null,
        },
      });
    });
    if (isPosLive(row.status)) {
      if (menuChanged) await this.sync.enqueue('menu', row.id);
      else await this.sync.enqueue('stop-list', row.id);
    }
    return this.status(orgId);
  }

  async preview(orgId: string) {
    const row = await this.requireRow(orgId);
    return this.menu.preview(row);
  }

  /** Runs the checks and stores them (GET shows the last result). */
  async runChecks(orgId: string): Promise<PosStatusDto> {
    const row = await this.requireRow(orgId);
    await this.check(row);
    return this.status(orgId);
  }

  private async check(row: Row): Promise<PosCheck[]> {
    const externalOrgId = this.requireOrg(row);
    const checks = await this.call(() =>
      this.provider.checks(
        this.keyring.credentials(row),
        externalOrgId,
        row.branch_links.map((b) => ({
          branchId: b.branch_id,
          terminalGroupId: b.terminal_group_id,
        })),
      ),
    );
    await this.prisma.pos_integration.update({
      where: { id: row.id },
      data: {
        checks: checks as unknown as Prisma.InputJsonValue,
        checked_at: new Date(),
      },
    });
    return checks;
  }

  /**
   * Enabling: every step done and every check green, otherwise 409 pos_setup_incomplete with the
   * list. Then the menu is imported with the confirmed pairs, the webhook set in iiko (a new random
   * authToken; the database keeps its hash), the stop list fetched and the menu import scheduled (IIKO_MENU_IMPORT_MINUTES).
   */
  async enable(orgId: string, matches: PosMatchDto[] = []) {
    this.assertConfigured();
    if (!publicApiUrl())
      throw platformMisconfigured(
        'pos',
        'PUBLIC_API_URL is not set: iiko has no webhook address',
      );
    const row = await this.requireRow(orgId);
    const steps = await this.stepsOf(row);
    const checks = row.external_org_id ? await this.check(row) : [];
    const missing = missingForEnable(steps, checks);
    if (missing.length)
      throw new AppException('pos_setup_incomplete', { details: { missing } });

    await this.ownProducts(orgId, matches);
    await this.menu.import(row, {
      pairing: true,
      matches: matches.map((m) => ({
        productId: m.productId,
        itemId: m.itemId ?? null,
      })),
    });
    const secret = randomBytes(32).toString('hex');
    const cred = this.keyring.credentials(row);
    await this.call(() =>
      this.provider.setWebhook(
        cred,
        row.external_org_id!,
        posWebhookUrl(row.id),
        secret,
      ),
    );
    this.logger.log(
      `integration ${row.id} enabled, webhook ${posWebhookUrl(row.id)}`,
    );
    await this.prisma.pos_integration.update({
      where: { id: row.id },
      data: {
        status: 'active',
        enabled_at: new Date(),
        webhook_secret_hash: hashWebhookSecret(secret),
      },
    });
    await this.stopList
      .refresh(row.id)
      .catch((e: unknown) =>
        this.logger.warn(
          `stop list of ${row.id} not fetched: ${iikoErrorText(e)}`,
        ),
      );
    await this.sync.schedule(row.id);
    return this.status(orgId);
  }

  private async ownProducts(orgId: string, matches: PosMatchDto[]) {
    const productIds = [...new Set(matches.map((m) => m.productId))];
    const own = await this.prisma.product.count({
      where: { id: { in: productIds }, category: { organization_id: orgId } },
    });
    if (own !== productIds.length)
      throw new AppException('not_found', { message: 'Product not found' });
  }

  /**
   * "Сопоставить заново": the dishes without a link are paired (the owner's pairs, then exact name)
   * and the rest hidden, as on enabling. Runs in the request, so the owner sees the result.
   */
  async rematch(orgId: string, matches: PosMatchDto[] = []) {
    const row = await this.requireRow(orgId);
    if (!isPosLive(row.status))
      throw new AppException('pos_setup_incomplete', {
        details: { missing: ['enabled'] },
      });
    await this.ownProducts(orgId, matches);
    await this.menu.import(row, {
      pairing: true,
      matches: matches.map((m) => ({
        productId: m.productId,
        itemId: m.itemId ?? null,
      })),
    });
    await this.stopList
      .refresh(row.id)
      .catch((e: unknown) =>
        this.logger.warn(
          `stop list of ${row.id} not fetched: ${iikoErrorText(e)}`,
        ),
      );
    return this.status(orgId);
  }

  /** "Обновить меню": queued; the result shows in GET (menuImportedAt / menuImportError). */
  async importNow(orgId: string) {
    const row = await this.requireRow(orgId);
    if (!isPosLive(row.status))
      throw new AppException('pos_setup_incomplete', {
        details: { missing: ['enabled'] },
      });
    await this.sync.enqueue('menu', row.id);
    return { queued: this.sync.enabled };
  }

  /** Courier mode changes only when the venue has no unfinished delivery orders. */
  async setCourierMode(orgId: string, mode: 'xmenu' | 'iiko') {
    const row = await this.requireRow(orgId);
    if (row.courier_mode !== mode) {
      const open = await this.prisma.customer_order.count({
        where: {
          organization_id: orgId,
          fulfillment: 'delivery',
          status: { in: [...LIVE_STATUSES] },
        },
      });
      if (open)
        throw new AppException('pos_courier_mode_locked', {
          message: 'Finish the open delivery orders first',
        });
      await this.prisma.pos_integration.update({
        where: { id: row.id },
        data: { courier_mode: mode },
      });
    }
    return this.status(orgId);
  }

  /**
   * Disconnecting (audit W15-03, W15-05): under the integration lock (a running menu import or stop
   * list refresh is waited for up to 10 s, then 409 pos_busy) the links, the menu links (dishes stay
   * as ordinary Xmenu dishes and become editable again), the stop list and the key go and the
   * integration is marked disconnected. The orders sent to iiko keep their history. Then the webhook
   * is removed in iiko (a failure is only logged) and the schedules stop. The answer counts the
   * orders already in iiko that are not finished: their statuses no longer come from iiko.
   */
  async disconnect(orgId: string) {
    const row = await this.row(orgId);
    if (!row || row.status === 'disconnected')
      return { connected: false as const, unfinishedOrders: 0 };
    // Read before the row changes: the webhook is removed with the old key
    const webhookOrg = row.webhook_secret_hash ? row.external_org_id : null;
    let cred: ReturnType<PosKeyring['credentials']> | null = null;
    try {
      cred = this.keyring.credentials(row);
    } catch (e) {
      this.logger.warn(
        `key of ${row.id} unreadable, the webhook stays in iiko: ${errorMessage(e)}`,
      );
    }
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await lockPosIntegration(tx, row.id, POS_LOCK_WAIT_MS);
          const where = { integration_id: row.id };
          await tx.pos_menu_link.deleteMany({ where });
          await tx.pos_stop_item.deleteMany({ where });
          await tx.pos_branch_link.deleteMany({ where });
          await tx.pos_payment_link.deleteMany({ where });
          await tx.pos_integration.update({
            where: { id: row.id },
            data: {
              status: 'disconnected',
              disconnected_at: new Date(),
              api_key_encrypted: null,
              webhook_secret_hash: null,
              enabled_at: null,
              checks: Prisma.DbNull,
              checked_at: null,
              alert: null,
              alert_at: null,
            },
          });
        },
        { timeout: POS_LOCK_WAIT_MS + 30_000 },
      );
    } catch (e) {
      if (isPosLockTimeout(e))
        throw new AppException('pos_busy', {
          cause: `integration ${row.id} is busy with a menu import`,
        });
      throw e;
    }
    if (cred && webhookOrg) {
      try {
        await this.provider.clearWebhook(cred, webhookOrg);
      } catch (e) {
        this.logger.warn(
          `webhook of ${row.id} not removed in iiko: ${iikoErrorText(e)}`,
        );
      }
    }
    await this.sync
      .unschedule(row.id)
      .catch((e: unknown) =>
        this.logger.warn(
          `scheduler of ${row.id} not removed: ${errorMessage(e)}`,
        ),
      );
    this.api.forget(row.id);
    await this.revalidate
      .addRevalidationJob({ tenantId: orgId, route: 'menu' })
      .catch((e: unknown) =>
        this.logger.warn(`revalidation not queued: ${errorMessage(e)}`),
      );
    const unfinishedOrders = await this.prisma.pos_order.count({
      where: {
        integration_id: row.id,
        state: { in: ['sending', 'sent'] },
        order: { status: { in: [...LIVE_STATUSES] } },
      },
    });
    return { connected: false as const, unfinishedOrders };
  }
}
