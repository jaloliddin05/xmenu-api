import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACTIVE } from 'src/modules/menu/menu.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { PrismaService } from '../../_prisma/prisma.service';
import {
  Channels,
  DeliveryMode,
  evaluateChecklist,
  isReady,
  modeNeedsBot,
  PublicationFacts,
} from '../domain/publication';
import { PublicationViewDto } from '../dto/publication.dto';

type Db = Prisma.TransactionClient;

const CHANNEL_FIELDS = {
  qr_enabled: true,
  delivery_enabled: true,
  delivery_mode: true,
  published_at: true,
} as const;

type ChannelRow = {
  qr_enabled: boolean;
  delivery_enabled: boolean;
  delivery_mode: DeliveryMode;
  published_at: Date | null;
};

/**
 * Channels and publication of the owner's venue (domain/publication.ts). Every write runs in one
 * transaction that first locks the organization row, so publish, unpublish and channel changes of a
 * venue go one at a time and the checklist is read in the same transaction it is acted on.
 */
@Injectable()
export class PublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidate: RevalidateService,
  ) {}

  view(organizationId: string): Promise<PublicationViewDto> {
    return this.buildView(this.prisma, organizationId);
  }

  async setChannels(
    organizationId: string,
    channels: Channels,
  ): Promise<PublicationViewDto> {
    const { view, changed } = await this.locked(
      organizationId,
      async (tx, row) => {
        const { enabled, mode } = channels.delivery;
        if (
          modeNeedsBot(mode) &&
          !(await this.botConnected(tx, organizationId))
        ) {
          throw new UnprocessableEntityException({
            code: 'telegram_bot_required',
            message:
              'Connect the venue Telegram bot before choosing the Mini App',
          });
        }
        const next: ChannelRow = {
          qr_enabled: channels.qr,
          delivery_enabled: enabled,
          delivery_mode: mode,
          // Turning ordering off pauses it: switching it back on needs a new, checked publication
          published_at: enabled ? row.published_at : null,
        };
        const changed = (Object.keys(next) as (keyof ChannelRow)[]).some(
          (k) => next[k] !== row[k],
        );
        if (changed) {
          await tx.organization.update({
            where: { id: organizationId },
            data: next,
          });
        }
        return { changed, view: await this.buildView(tx, organizationId) };
      },
    );
    if (changed) await this.changed(organizationId);
    return view;
  }

  async publish(organizationId: string): Promise<PublicationViewDto> {
    const { view, changed } = await this.locked(
      organizationId,
      async (tx, row) => {
        // Already live: nothing to check or write (repeated or parallel clicks get the same answer)
        if (row.published_at) {
          return {
            changed: false,
            view: await this.buildView(tx, organizationId),
          };
        }
        const checklist = evaluateChecklist(
          await this.facts(tx, organizationId),
        );
        if (!isReady(checklist)) {
          throw new ConflictException({
            code: 'publication_incomplete',
            message: 'Publication checklist is not complete',
            details: { missing: checklist.filter((i) => i.status === 'todo') },
          });
        }
        // Conditional: of concurrent publishes only one sets the timestamp, even without the row lock
        const { count } = await tx.organization.updateMany({
          where: { id: organizationId, published_at: null },
          data: { published_at: new Date() },
        });
        return {
          changed: count > 0,
          view: await this.buildView(tx, organizationId),
        };
      },
    );
    if (changed) await this.changed(organizationId);
    return view;
  }

  async unpublish(organizationId: string): Promise<PublicationViewDto> {
    const { view, changed } = await this.locked(organizationId, async (tx) => {
      const { count } = await tx.organization.updateMany({
        where: { id: organizationId, published_at: { not: null } },
        data: { published_at: null },
      });
      return {
        changed: count > 0,
        view: await this.buildView(tx, organizationId),
      };
    });
    if (changed) await this.changed(organizationId);
    return view;
  }

  /** Front-ends show the ordering state (GET /tenant/config channels, fulfillment). */
  private changed(organizationId: string) {
    return this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'channels',
    });
  }

  private locked<T>(
    organizationId: string,
    fn: (tx: Db, row: ChannelRow) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
      return fn(tx, await this.channelRow(tx, organizationId));
    });
  }

  private async channelRow(
    db: Db,
    organizationId: string,
  ): Promise<ChannelRow> {
    const row = await db.organization.findUnique({
      where: { id: organizationId },
      select: CHANNEL_FIELDS,
    });
    if (!row) throw new NotFoundException('Organization not found');
    return row;
  }

  private async buildView(
    db: Db,
    organizationId: string,
  ): Promise<PublicationViewDto> {
    const [row, facts] = await Promise.all([
      this.channelRow(db, organizationId),
      this.facts(db, organizationId),
    ]);
    const checklist = evaluateChecklist(facts);
    return {
      published: row.delivery_enabled && row.published_at !== null,
      publishedAt: row.published_at?.toISOString() ?? null,
      ready: isReady(checklist),
      channels: {
        qr: row.qr_enabled,
        delivery: { enabled: row.delivery_enabled, mode: row.delivery_mode },
      },
      checklist,
    };
  }

  private async facts(
    db: Db,
    organizationId: string,
  ): Promise<PublicationFacts> {
    const [org, categories, products, branches, ordering, botConnected] =
      await Promise.all([
        db.organization.findUnique({
          where: { id: organizationId },
          select: {
            name: true,
            slug: true,
            delivery_enabled: true,
            delivery_mode: true,
          },
        }),
        db.category.count({
          where: { organization_id: organizationId, ...ACTIVE },
        }),
        // What the menu shows: an active dish in an active category
        db.product.count({
          where: {
            AND: [
              ACTIVE,
              { category: { organization_id: organizationId, ...ACTIVE } },
            ],
          },
        }),
        db.branch.findMany({
          where: { organization_id: organizationId, is_active: true },
          select: {
            latitude: true,
            longitude: true,
            accepts_pickup: true,
            accepts_delivery: true,
            working_hours: { select: { is_closed: true } },
          },
        }),
        db.organization_order_settings.findUnique({
          where: { organization_id: organizationId },
          select: { delivery_zone: true },
        }),
        this.botConnected(db, organizationId),
      ]);
    if (!org) throw new NotFoundException('Organization not found');
    return {
      name: org.name,
      slug: org.slug,
      deliveryEnabled: org.delivery_enabled,
      deliveryMode: org.delivery_mode,
      hasActiveCategory: categories > 0,
      hasActiveProduct: products > 0,
      branches: branches.map((b) => ({
        hasHours: b.working_hours.some((d) => !d.is_closed),
        hasCoordinates: !(b.latitude === 0 && b.longitude === 0),
        acceptsPickup: b.accepts_pickup,
        acceptsDelivery: b.accepts_delivery,
      })),
      // The row is created at signup; no row means no zone, like delivery_zone = NULL
      hasDeliveryZone: ordering?.delivery_zone != null,
      botConnected,
    };
  }

  private async botConnected(db: Db, organizationId: string): Promise<boolean> {
    const bot = await db.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
      select: { is_enabled: true },
    });
    return bot?.is_enabled === true;
  }
}
