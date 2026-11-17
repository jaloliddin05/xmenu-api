import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { AppException } from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import {
  ImportPlan,
  MenuMatch,
  planMenuImport,
  PlannedProduct,
} from '../domain/menu-import-plan';
import { iikoErrorText, toAppException } from '../iiko/iiko-api.client';
import { POS_PROVIDER, PosMenu, PosMenuItem } from '../provider/pos-provider';
import type { PosProvider } from '../provider/pos-provider';
import { PosImageStore, StoredImage } from './pos-image.store';
import { PosKeyring } from './pos-keyring';

type Tx = Prisma.TransactionClient;

/** Name of the option group made from the sizes of a dish, in the language of the POS names. */
const SIZE_GROUP_TITLE: Record<string, string> = {
  ru: 'Размер',
  uz: 'Oʻlcham',
  en: 'Size',
};

const TX_TIMEOUT_MS = 120_000;

export interface ImportedIntegration {
  id: string;
  organization_id: string;
  api_key_encrypted: string;
  external_org_id: string | null;
  external_menu_id: string | null;
  price_category_id: string | null;
  delivery_item_id: string | null;
  source_lang: string | null;
}

/** What the owner sees before enabling: pairs, new positions, dishes that will be hidden. */
export interface ImportPreview {
  pairs: {
    productId: string;
    productTitle: string | null;
    itemId: string;
    itemName: string;
    byName: boolean;
  }[];
  newItems: { itemId: string; name: string }[];
  unmatched: { productId: string; title: string | null }[];
}

/**
 * Imports the POS external menu (docs/IIKO.md, "Меню"). Everything is fetched and planned first,
 * then written in one transaction: a failure leaves the previous menu as it was and records the
 * reason on the integration.
 */
@Injectable()
export class PosMenuImportService {
  private readonly logger = new Logger('PosMenuImport');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    private readonly keyring: PosKeyring,
    private readonly images: PosImageStore,
    private readonly revalidate: RevalidateService,
  ) {}

  private async sourceLang(row: ImportedIntegration): Promise<string> {
    if (row.source_lang) return row.source_lang;
    const settings = await this.prisma.organization_settings.findUnique({
      where: { organization_id: row.organization_id },
      select: { default_language: true },
    });
    if (!settings)
      throw new AppException('settings_missing', {
        cause: `organization_settings of ${row.organization_id} is missing`,
      });
    return settings.default_language;
  }

  async fetchMenu(row: ImportedIntegration): Promise<PosMenu> {
    if (!row.external_org_id || !row.external_menu_id)
      throw new AppException('pos_setup_incomplete', {
        details: { missing: ['links'] },
      });
    try {
      return await this.provider.fetchMenu(
        this.keyring.credentials(row),
        row.external_org_id,
        row.external_menu_id,
        row.price_category_id,
      );
    } catch (e) {
      throw toAppException(e);
    }
  }

  private async plan(
    row: ImportedIntegration,
    menu: PosMenu,
    lang: string,
    matches?: MenuMatch[],
  ): Promise<ImportPlan> {
    const orgId = row.organization_id;
    const [links, products, categories] = await Promise.all([
      this.prisma.pos_menu_link.findMany({
        where: {
          integration_id: row.id,
          kind: { in: ['category', 'product'] },
        },
        select: {
          id: true,
          kind: true,
          external_id: true,
          category_id: true,
          product_id: true,
          source_name: true,
          source_image_url: true,
        },
      }),
      this.prisma.product.findMany({
        where: { category: { organization_id: orgId } },
        select: {
          id: true,
          pos_link: { select: { id: true } },
          translations: { where: { lang }, select: { title: true } },
          images: { select: { from_pos: true } },
        },
      }),
      this.prisma.category.findMany({
        where: { organization_id: orgId, pos_link: null },
        select: {
          id: true,
          translations: { where: { lang }, select: { title: true } },
        },
      }),
    ]);
    const ownerImage = (p: (typeof products)[number]) =>
      p.images.some((i) => !i.from_pos);
    return planMenuImport({
      menu,
      serviceItemId: row.delivery_item_id,
      links: links.map((l) => ({
        id: l.id,
        kind: l.kind as 'category' | 'product',
        externalId: l.external_id,
        rowId: (l.kind === 'category' ? l.category_id : l.product_id) ?? '',
        sourceName: l.source_name,
        sourceImageUrl: l.source_image_url,
      })),
      unlinkedProducts: products
        .filter((p) => !p.pos_link)
        .map((p) => ({
          id: p.id,
          title: p.translations[0]?.title ?? null,
          hasOwnerImage: ownerImage(p),
        })),
      unlinkedCategories: categories.map((c) => ({
        id: c.id,
        title: c.translations[0]?.title ?? null,
      })),
      ownerImageProductIds: new Set(
        products.filter((p) => p.pos_link && ownerImage(p)).map((p) => p.id),
      ),
      matches,
    });
  }

  /** Pairs and changes the first import would make (step "Меню"). */
  async preview(row: ImportedIntegration): Promise<ImportPreview> {
    const menu = await this.fetchMenu(row);
    const lang = await this.sourceLang(row);
    const plan = await this.plan(row, menu, lang);
    const titles = new Map(
      (
        await this.prisma.product_translation.findMany({
          where: {
            lang,
            product_id: {
              in: [...plan.pairs.map((p) => p.productId), ...plan.hideProducts],
            },
          },
          select: { product_id: true, title: true },
        })
      ).map((t) => [t.product_id, t.title]),
    );
    const names = new Map(menu.items.map((i) => [i.externalId, i.name]));
    return {
      pairs: plan.pairs.map((p) => ({
        productId: p.productId,
        productTitle: titles.get(p.productId) ?? null,
        itemId: p.itemId,
        itemName: names.get(p.itemId) ?? '',
        byName: p.byName,
      })),
      newItems: plan.products
        .filter((p) => !p.targetId)
        .map((p) => ({ itemId: p.source.externalId, name: p.source.name })),
      unmatched: plan.hideProducts.map((id) => ({
        productId: id,
        title: titles.get(id) ?? null,
      })),
    };
  }

  /**
   * Imports the menu. On failure the previous menu stays, the reason code is stored on the
   * integration and the error is rethrown.
   */
  async import(row: ImportedIntegration, matches?: MenuMatch[]): Promise<void> {
    try {
      const menu = await this.fetchMenu(row);
      const lang = await this.sourceLang(row);
      const plan = await this.plan(row, menu, lang, matches);
      const pictures = await this.download(plan.products);
      await this.prisma.$transaction(
        (tx) => this.apply(tx, row, plan, pictures, lang),
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      const err = toAppException(e);
      this.logger.warn(
        `menu import of integration ${row.id} failed: ${err.code} (${iikoErrorText(e)})`,
      );
      await this.prisma.pos_integration
        .update({
          where: { id: row.id },
          data: { menu_import_error: err.code },
        })
        .catch(() => undefined);
      // The key was revoked or expired: the owner has to reconnect, orders keep coming
      if (err.code === 'pos_key_invalid')
        await this.prisma.pos_integration
          .updateMany({
            where: { id: row.id, status: 'active' },
            data: { status: 'needs_reconnect' },
          })
          .catch(() => undefined);
      throw err;
    }
    await this.revalidate
      .addRevalidationJob({ tenantId: row.organization_id, route: 'menu' })
      .catch((e: unknown) =>
        this.logger.warn(`revalidation not queued: ${errorMessage(e)}`),
      );
  }

  /** POS pictures that changed; a picture that fails stays as it was and is tried next time. */
  private async download(products: PlannedProduct[]) {
    const out = new Map<string, StoredImage>();
    const byUrl = new Map<string, StoredImage | null>();
    for (const p of products) {
      const url = p.downloadImage;
      if (!url) continue;
      if (!byUrl.has(url)) {
        byUrl.set(
          url,
          await this.images.fetch(url).catch((e: unknown) => {
            this.logger.warn(
              `POS picture of ${p.source.externalId} not copied: ${errorMessage(e)}`,
            );
            return null;
          }),
        );
      }
      const stored = byUrl.get(url);
      if (stored) out.set(p.source.externalId, stored);
    }
    return out;
  }

  private async apply(
    tx: Tx,
    row: ImportedIntegration,
    plan: ImportPlan,
    pictures: Map<string, StoredImage>,
    lang: string,
  ) {
    const orgId = row.organization_id;
    const categoryIds = new Map<string, string>();
    let position = 0;
    for (const c of plan.categories) {
      let id = c.targetId;
      if (id) {
        await this.sourceTitle(
          tx,
          'category',
          id,
          lang,
          c.source.name,
          c.nameChanged,
        );
      } else {
        id = (
          await tx.category.create({
            data: {
              organization_id: orgId,
              index: position,
              translations: { create: [{ lang, title: c.source.name }] },
            },
            select: { id: true },
          })
        ).id;
      }
      position++;
      categoryIds.set(c.source.externalId, id);
      await this.link(tx, row.id, c.linkId, {
        kind: 'category',
        external_id: c.source.externalId,
        category_id: id,
        source_name: c.source.name,
        hidden_in_pos: c.source.hidden,
      });
    }

    for (const p of plan.products) {
      const item = p.source;
      const categoryId = categoryIds.get(item.categoryExternalId);
      if (!categoryId) continue;
      const fields = {
        price: item.price,
        weight: item.weight,
        unit: item.unit,
        protein: item.nutrition.protein,
        fat: item.nutrition.fat,
        carbohydrate: item.nutrition.carbohydrate,
        kcal: item.nutrition.kcal,
        category_id: categoryId,
      };
      let id = p.targetId;
      if (id) {
        await tx.product.update({ where: { id }, data: fields });
        await this.sourceTitle(
          tx,
          'product',
          id,
          lang,
          item.name,
          p.nameChanged,
        );
      } else {
        id = (
          await tx.product.create({
            data: {
              ...fields,
              index: item.sortOrder,
              translations: {
                create: [
                  { lang, title: item.name, description: item.description },
                ],
              },
            },
            select: { id: true },
          })
        ).id;
      }
      const picture = pictures.get(item.externalId);
      if (picture) {
        await tx.file.deleteMany({ where: { product_id: id, from_pos: true } });
        await tx.file.create({
          data: {
            url: picture.url,
            path: picture.path,
            content_hash: picture.hash,
            from_pos: true,
            product_id: id,
          },
        });
      }
      await this.link(tx, row.id, p.linkId, {
        kind: 'product',
        external_id: item.externalId,
        // The single size an order of this item names (several sizes: the size option carries it)
        size_id: item.defaultSizeId,
        product_id: id,
        source_name: item.name,
        hidden_in_pos: item.hidden,
        ...(picture ? { source_image_url: p.downloadImage } : {}),
      });
      await this.syncGroups(tx, row, id, item, lang);
    }

    if (plan.hideProducts.length)
      await tx.product.updateMany({
        where: { id: { in: plan.hideProducts } },
        data: { is_active: false },
      });
    if (plan.goneLinks.length)
      await tx.pos_menu_link.updateMany({
        where: { id: { in: plan.goneLinks } },
        data: { hidden_in_pos: true },
      });
    await tx.pos_integration.update({
      where: { id: row.id },
      data: {
        menu_imported_at: new Date(),
        menu_import_error: null,
        source_lang: lang,
      },
    });
  }

  private async link(
    tx: Tx,
    integrationId: string,
    linkId: string | null,
    data: Omit<Prisma.pos_menu_linkUncheckedCreateInput, 'integration_id'>,
  ) {
    if (linkId) {
      await tx.pos_menu_link.update({ where: { id: linkId }, data });
      return;
    }
    await tx.pos_menu_link.create({
      data: { ...data, integration_id: integrationId },
    });
  }

  /**
   * Option groups of a linked dish follow the POS: the sizes as one required group, then the
   * modifier groups. Groups and options are updated through their links; the rest (including
   * groups the owner made before the dish was paired) is removed. Orders keep their own copy.
   */
  private async syncGroups(
    tx: Tx,
    row: ImportedIntegration,
    productId: string,
    item: PosMenuItem,
    lang: string,
  ) {
    const wanted: {
      kind: 'size_group' | 'modifier_group';
      externalId: string;
      title: string;
      min: number;
      max: number;
      options: {
        kind: 'size' | 'modifier';
        externalId: string;
        sizeId?: string;
        title: string;
        price: number;
      }[];
    }[] = [];
    if (item.sizes.length > 1)
      wanted.push({
        kind: 'size_group',
        externalId: item.externalId,
        title: SIZE_GROUP_TITLE[lang] ?? SIZE_GROUP_TITLE.en,
        min: 1,
        max: 1,
        options: item.sizes.map((s) => ({
          kind: 'size',
          externalId: `${item.externalId}:${s.sizeId}`,
          sizeId: s.sizeId,
          title: s.name,
          price: Math.max(0, s.price - item.price),
        })),
      });
    for (const g of item.modifierGroups) {
      const groupKey = `${item.externalId}/${g.externalId}`;
      wanted.push({
        kind: 'modifier_group',
        externalId: groupKey,
        title: g.name,
        min: g.min,
        max: g.max,
        options: g.options.map((o) => ({
          kind: 'modifier',
          externalId: `${groupKey}/${o.externalId}`,
          title: o.name,
          price: o.price,
        })),
      });
    }

    const existing = await tx.additional_product_group.findMany({
      where: { product_id: productId },
      select: {
        id: true,
        pos_link: {
          select: { id: true, external_id: true, source_name: true },
        },
        additional_products: {
          select: {
            id: true,
            pos_link: {
              select: { id: true, external_id: true, source_name: true },
            },
          },
        },
      },
    });
    const keep = new Set(wanted.map((w) => w.externalId));
    const stale = existing.filter(
      (g) => !g.pos_link || !keep.has(g.pos_link.external_id),
    );
    if (stale.length)
      await tx.additional_product_group.deleteMany({
        where: { id: { in: stale.map((g) => g.id) } },
      });

    for (const w of wanted) {
      const current = existing.find(
        (g) => g.pos_link?.external_id === w.externalId,
      );
      const groupData = {
        is_required: w.min > 0,
        is_multiple: w.max > 1,
        min_selected: w.min,
        max_selected: w.max,
      };
      let groupId: string;
      if (current) {
        groupId = current.id;
        await tx.additional_product_group.update({
          where: { id: groupId },
          data: groupData,
        });
        await this.sourceTitle(
          tx,
          'group',
          groupId,
          lang,
          w.title,
          current.pos_link!.source_name !== w.title,
        );
        await tx.pos_menu_link.update({
          where: { id: current.pos_link!.id },
          data: { source_name: w.title, hidden_in_pos: false },
        });
      } else {
        groupId = (
          await tx.additional_product_group.create({
            data: {
              ...groupData,
              product_id: productId,
              organization_id: row.organization_id,
              translations: { create: [{ lang, title: w.title }] },
            },
            select: { id: true },
          })
        ).id;
        await tx.pos_menu_link.create({
          data: {
            integration_id: row.id,
            kind: w.kind,
            external_id: w.externalId,
            group_id: groupId,
            source_name: w.title,
          },
        });
      }

      const options = current?.additional_products ?? [];
      const keepOptions = new Set(w.options.map((o) => o.externalId));
      const dropOptions = options.filter(
        (o) => !o.pos_link || !keepOptions.has(o.pos_link.external_id),
      );
      if (dropOptions.length)
        await tx.additional_product.deleteMany({
          where: { id: { in: dropOptions.map((o) => o.id) } },
        });
      for (const o of w.options) {
        const had = options.find(
          (x) => x.pos_link?.external_id === o.externalId,
        );
        if (had) {
          await tx.additional_product.update({
            where: { id: had.id },
            data: { price: o.price },
          });
          await this.sourceTitle(
            tx,
            'option',
            had.id,
            lang,
            o.title,
            had.pos_link!.source_name !== o.title,
          );
          await tx.pos_menu_link.update({
            where: { id: had.pos_link!.id },
            data: { source_name: o.title, size_id: o.sizeId ?? null },
          });
          continue;
        }
        const optionId = (
          await tx.additional_product.create({
            data: {
              price: o.price,
              additional_product_group_id: groupId,
              translations: { create: [{ lang, title: o.title }] },
            },
            select: { id: true },
          })
        ).id;
        await tx.pos_menu_link.create({
          data: {
            integration_id: row.id,
            kind: o.kind,
            external_id: o.externalId,
            size_id: o.sizeId ?? null,
            option_id: optionId,
            source_name: o.title,
          },
        });
      }
    }
  }

  /**
   * The translation in the language of the POS names follows the POS. When the name changed there,
   * translations in the other languages are marked stale (the owner sees "перевод устарел").
   */
  private async sourceTitle(
    tx: Tx,
    kind: 'category' | 'product' | 'group' | 'option',
    id: string,
    lang: string,
    title: string,
    nameChanged: boolean,
  ) {
    const ops = translationOps(tx, kind, id);
    const current = await ops.find(lang);
    if (!current) await ops.create(lang, title);
    else if (current.title !== title) await ops.update(current.id, title);
    if (nameChanged) await ops.markStale(lang);
  }
}

/** The four translation tables differ only in the name of the parent column. */
function translationOps(
  tx: Tx,
  kind: 'category' | 'product' | 'group' | 'option',
  id: string,
) {
  const select = { id: true, title: true } as const;
  switch (kind) {
    case 'category':
      return {
        find: (lang: string) =>
          tx.category_translation.findFirst({
            where: { category_id: id, lang },
            select,
          }),
        create: (lang: string, title: string) =>
          tx.category_translation.create({
            data: { category_id: id, lang, title },
          }),
        update: (tid: string, title: string) =>
          tx.category_translation.update({
            where: { id: tid },
            data: { title, stale: false },
          }),
        markStale: (lang: string) =>
          tx.category_translation.updateMany({
            where: { category_id: id, lang: { not: lang } },
            data: { stale: true },
          }),
      };
    case 'product':
      return {
        find: (lang: string) =>
          tx.product_translation.findFirst({
            where: { product_id: id, lang },
            select,
          }),
        create: (lang: string, title: string) =>
          tx.product_translation.create({
            data: { product_id: id, lang, title },
          }),
        update: (tid: string, title: string) =>
          tx.product_translation.update({
            where: { id: tid },
            data: { title, stale: false },
          }),
        markStale: (lang: string) =>
          tx.product_translation.updateMany({
            where: { product_id: id, lang: { not: lang } },
            data: { stale: true },
          }),
      };
    case 'group':
      return {
        find: (lang: string) =>
          tx.additional_product_group_translation.findFirst({
            where: { additional_product_group_id: id, lang },
            select,
          }),
        create: (lang: string, title: string) =>
          tx.additional_product_group_translation.create({
            data: { additional_product_group_id: id, lang, title },
          }),
        update: (tid: string, title: string) =>
          tx.additional_product_group_translation.update({
            where: { id: tid },
            data: { title, stale: false },
          }),
        markStale: (lang: string) =>
          tx.additional_product_group_translation.updateMany({
            where: { additional_product_group_id: id, lang: { not: lang } },
            data: { stale: true },
          }),
      };
    case 'option':
      return {
        find: (lang: string) =>
          tx.additional_product_translation.findFirst({
            where: { additional_product_id: id, lang },
            select,
          }),
        create: (lang: string, title: string) =>
          tx.additional_product_translation.create({
            data: { additional_product_id: id, lang, title },
          }),
        update: (tid: string, title: string) =>
          tx.additional_product_translation.update({
            where: { id: tid },
            data: { title, stale: false },
          }),
        markStale: (lang: string) =>
          tx.additional_product_translation.updateMany({
            where: { additional_product_id: id, lang: { not: lang } },
            data: { stale: true },
          }),
      };
  }
}
