import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { errorMessage } from 'src/infra/helper/error-text';
import { stoppedProducts } from '../domain/stop-list';
import { toAppException } from '../iiko/iiko-api.client';
import { POS_PROVIDER } from '../provider/pos-provider';
import type { PosProvider, PosStopList } from '../provider/pos-provider';
import { PosKeyring } from './pos-keyring';
import { isPosLive } from '../domain/pos-steps';
import { lockPosIntegration } from './pos-lock';

/**
 * The POS stop list per branch (docs/IIKO.md, "Стоп-лист и цены"): fetched after the StopListUpdate
 * webhook (a signal only) and with every menu import; no polling. Rows are replaced per branch,
 * under the integration lock (pos-lock.ts). Sizes are asked for (returnSize): one size can be stopped.
 */
@Injectable()
export class PosStopListService {
  private readonly logger = new Logger('PosStopList');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    private readonly keyring: PosKeyring,
    private readonly revalidate: RevalidateService,
  ) {}

  async refresh(integrationId: string): Promise<void> {
    const row = await this.prisma.pos_integration.findUnique({
      where: { id: integrationId },
      select: {
        id: true,
        organization_id: true,
        api_key_encrypted: true,
        external_org_id: true,
        status: true,
        branch_links: { select: { branch_id: true, terminal_group_id: true } },
      },
    });
    if (!row?.external_org_id || !isPosLive(row.status)) return;
    let lists: PosStopList[];
    try {
      lists = await this.provider.fetchStopLists(
        this.keyring.credentials(row),
        row.external_org_id,
        [...new Set(row.branch_links.map((l) => l.terminal_group_id))],
      );
    } catch (e) {
      throw toAppException(e);
    }
    const links = await this.prisma.pos_menu_link.findMany({
      where: { integration_id: row.id, kind: { in: ['product', 'size'] } },
      select: {
        kind: true,
        external_id: true,
        product_id: true,
        option_id: true,
      },
    });
    const products = new Map(
      links
        .filter((l) => l.kind === 'product' && l.product_id)
        .map((l) => [l.external_id, l.product_id!]),
    );
    // A size link: external id <itemId>:<sizeId>, the row is the "size" option
    const sizes = new Map<string, Map<string, string>>();
    for (const l of links)
      if (l.kind === 'size' && l.option_id) {
        const [itemId, sizeId] = l.external_id.split(':');
        if (!sizeId) continue;
        sizes.set(
          itemId,
          (sizes.get(itemId) ?? new Map<string, string>()).set(
            sizeId,
            l.option_id,
          ),
        );
      }
    const written = await this.prisma.$transaction(async (tx) => {
      await lockPosIntegration(tx, row.id);
      // Disconnected while the stop list was being fetched: nothing to write
      const now = await tx.pos_integration.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      if (!isPosLive(now?.status)) return false;
      for (const link of row.branch_links) {
        const list = lists.find(
          (l) => l.terminalGroupId === link.terminal_group_id,
        );
        const stopped = stoppedProducts(list?.items ?? [], products, sizes);
        await tx.pos_stop_item.deleteMany({
          where: { branch_id: link.branch_id },
        });
        if (stopped.length)
          await tx.pos_stop_item.createMany({
            data: stopped.map((s) => ({
              integration_id: row.id,
              branch_id: link.branch_id,
              product_id: s.productId,
              option_id: s.optionId,
              balance: s.balance,
            })),
            skipDuplicates: true,
          });
      }
      await tx.pos_integration.update({
        where: { id: row.id },
        data: { stop_list_updated_at: new Date() },
      });
      return true;
    });
    if (!written) return;
    await this.revalidate
      .addRevalidationJob({ tenantId: row.organization_id, route: 'menu' })
      .catch((e: unknown) =>
        this.logger.warn(`revalidation not queued: ${errorMessage(e)}`),
      );
  }
}
