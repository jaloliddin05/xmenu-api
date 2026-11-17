import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import type {
  PosAddressFormat,
  PosCheck,
  PosCredentials,
  PosDictionaries,
  PosMenu,
  PosOrganization,
  PosProvider,
  PosStopList,
  PosWebhookEvent,
} from '../provider/pos-provider';
import { IikoApiClient, IikoApiError } from './iiko-api.client';
import { IikoMenuV3, iikoMenuToPos } from './iiko-menu';
import { parseIikoWebhook } from './iiko-webhook';

const MENU_TIMEOUT_MS = 60_000;

interface Named {
  id: string;
  name?: string | null;
}

/** iiko addressFormatType → how Xmenu passes a delivery address (docs/IIKO.md, decision 8). */
export function iikoAddressFormat(raw: unknown): PosAddressFormat {
  if (raw === 'City') return 'city';
  if (raw === 'Legacy') return 'legacy';
  return 'unknown';
}

/** iiko Cloud API adapter (docs/IIKO.md, "Проверка документации"). */
@Injectable()
export class IikoProvider implements PosProvider {
  constructor(private readonly api: IikoApiClient) {}

  async verifyKey(cred: PosCredentials): Promise<void> {
    await this.api.token(cred, true);
  }

  async listOrganizations(cred: PosCredentials): Promise<PosOrganization[]> {
    const { organizations } = await this.api.call<{
      organizations?: Named[] | null;
    }>(cred, '/api/1/organizations', {
      returnAdditionalInfo: false,
      includeDisabled: false,
    });
    return (organizations ?? [])
      .filter((o) => o?.id)
      .map((o) => ({ id: o.id, name: o.name ?? '' }));
  }

  async addressFormat(
    cred: PosCredentials,
    orgId: string,
  ): Promise<PosAddressFormat> {
    const { organizations } = await this.api.call<{
      organizations?: (Named & { addressFormatType?: unknown })[] | null;
    }>(cred, '/api/1/organizations', {
      organizationIds: [orgId],
      returnAdditionalInfo: true,
      includeDisabled: false,
    });
    const org = (organizations ?? []).find((o) => o?.id === orgId);
    if (!org)
      throw new AppException('pos_access_denied', {
        cause: 'the iiko organization is not available to this key',
      });
    return iikoAddressFormat(org.addressFormatType);
  }

  async dictionaries(
    cred: PosCredentials,
    orgId: string,
  ): Promise<PosDictionaries> {
    const [groups, payments, menus] = await Promise.all([
      this.api.call<{
        terminalGroups?: { items?: Named[] | null }[] | null;
      }>(cred, '/api/1/terminal_groups', {
        organizationIds: [orgId],
        includeDisabled: false,
      }),
      this.api.call<{
        paymentTypes?: (Named & {
          paymentTypeKind?: string | null;
          isDeleted?: boolean;
        })[];
      }>(cred, '/api/1/payment_types', { organizationIds: [orgId] }),
      this.menus(cred),
    ]);
    return {
      terminalGroups: (groups.terminalGroups ?? [])
        .flatMap((w) => w?.items ?? [])
        .filter((t) => t?.id)
        .map((t) => ({ id: t.id, name: t.name ?? '' })),
      paymentTypes: (payments.paymentTypes ?? [])
        .filter((p) => p?.id && !p.isDeleted)
        .map((p) => ({
          id: p.id,
          name: p.name ?? '',
          kind: p.paymentTypeKind ?? 'Unknown',
        })),
      ...menus,
    };
  }

  private async menus(cred: PosCredentials) {
    const data = await this.api.call<{
      externalMenus?: Named[] | null;
      priceCategories?: Named[] | null;
    }>(cred, '/api/2/menu', {});
    const named = (list?: Named[] | null) =>
      (list ?? [])
        .filter((m) => m?.id)
        .map((m) => ({ id: String(m.id), name: m.name ?? '' }));
    return {
      externalMenus: named(data.externalMenus),
      priceCategories: named(data.priceCategories),
    };
  }

  async terminalsAlive(
    cred: PosCredentials,
    orgId: string,
    terminalGroupIds: string[],
  ): Promise<Map<string, boolean>> {
    if (!terminalGroupIds.length) return new Map();
    const { isAliveStatus } = await this.api.call<{
      isAliveStatus?: { terminalGroupId: string; isAlive: boolean }[];
    }>(cred, '/api/1/terminal_groups/is_alive', {
      organizationIds: [orgId],
      terminalGroupIds: [...new Set(terminalGroupIds)],
    });
    return new Map(
      (isAliveStatus ?? []).map((s) => [s.terminalGroupId, Boolean(s.isAlive)]),
    );
  }

  async checks(
    cred: PosCredentials,
    orgId: string,
    terminals: { branchId: string; terminalGroupId: string }[],
  ): Promise<PosCheck[]> {
    const out: PosCheck[] = [];
    const failed = (key: PosCheck['key'], e: unknown): PosCheck => ({
      key,
      status:
        e instanceof IikoApiError && e.status !== null ? 'fail' : 'unknown',
      code:
        e instanceof IikoApiError || e instanceof AppException
          ? e.code
          : 'pos_unavailable',
    });
    // Rights of the key on the organization
    try {
      await this.addressFormat(cred, orgId);
      out.push({ key: 'key_access', status: 'ok' });
    } catch (e) {
      out.push(
        e instanceof AppException
          ? { key: 'key_access', status: 'fail', code: e.code }
          : failed('key_access', e),
      );
    }
    // Delivery module: a delivery method answers 402 without it (the license list names no module id)
    try {
      await this.api.call(cred, '/api/1/deliveries/order_types', {
        organizationIds: [orgId],
      });
      out.push({ key: 'delivery_module', status: 'ok' });
    } catch (e) {
      out.push(failed('delivery_module', e));
    }
    if (!terminals.length) return out;
    try {
      const alive = await this.terminalsAlive(
        cred,
        orgId,
        terminals.map((t) => t.terminalGroupId),
      );
      for (const t of terminals)
        out.push({
          key: 'terminal_alive',
          branchId: t.branchId,
          status: alive.get(t.terminalGroupId) ? 'ok' : 'fail',
        });
    } catch (e) {
      for (const t of terminals)
        out.push({ ...failed('terminal_alive', e), branchId: t.branchId });
    }
    return out;
  }

  async fetchMenu(
    cred: PosCredentials,
    orgId: string,
    menuId: string,
    priceCategoryId: string | null,
  ): Promise<PosMenu> {
    const { externalMenus } = await this.menus(cred);
    if (!externalMenus.some((m) => m.id === menuId))
      throw new AppException('pos_external_menu_missing', {
        cause: 'the chosen external menu is not in /api/2/menu',
      });
    const menu = await this.api.call<IikoMenuV3>(
      cred,
      '/api/menu/v3/by_id',
      { externalMenuId: menuId, organizationId: orgId, priceCategoryId },
      MENU_TIMEOUT_MS,
    );
    return iikoMenuToPos(menu ?? {});
  }

  async fetchStopLists(
    cred: PosCredentials,
    orgId: string,
    terminalGroupIds: string[],
  ): Promise<PosStopList[]> {
    if (!terminalGroupIds.length) return [];
    const { terminalGroupStopLists } = await this.api.call<{
      terminalGroupStopLists?: {
        items?: {
          terminalGroupId?: string;
          items?: {
            productId: string;
            sizeId?: string | null;
            balance: number;
          }[];
        }[];
      }[];
    }>(cred, '/api/1/stop_lists', {
      organizationIds: [orgId],
      terminalGroupsIds: terminalGroupIds,
    });
    const lists = new Map<string, PosStopList>();
    for (const wrapper of terminalGroupStopLists ?? [])
      for (const list of wrapper?.items ?? []) {
        if (!list?.terminalGroupId) continue;
        const entry = lists.get(list.terminalGroupId) ?? {
          terminalGroupId: list.terminalGroupId,
          items: [],
        };
        for (const i of list.items ?? [])
          if (i?.productId)
            entry.items.push({
              externalId: i.productId,
              sizeId: i.sizeId ?? null,
              balance: Number(i.balance) || 0,
            });
        lists.set(list.terminalGroupId, entry);
      }
    return [...lists.values()];
  }

  async setWebhook(
    cred: PosCredentials,
    orgId: string,
    url: string,
    authToken: string,
  ): Promise<void> {
    await this.api.call(cred, '/api/1/webhooks/update_settings', {
      organizationId: orgId,
      webHooksUri: url,
      authToken,
      webHooksFilter: {
        deliveryOrderFilter: { errors: true },
        stopListUpdateFilter: { updates: true },
      },
    });
  }

  async clearWebhook(cred: PosCredentials, orgId: string): Promise<void> {
    await this.api.call(cred, '/api/1/webhooks/update_settings', {
      organizationId: orgId,
      webHooksUri: '',
      authToken: null,
      webHooksFilter: null,
    });
  }

  parseWebhook(body: unknown): PosWebhookEvent[] {
    return parseIikoWebhook(body);
  }
}
