import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { COURIER_HELD_STATUSES } from 'src/modules/order/domain/order-state-machine';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { telegramErrorText } from 'src/modules/telegram/telegram-client';
import {
  COURIER_INVITE_TTL_MS,
  inviteLink,
  newInviteToken,
} from '../domain/courier-invitation';
import { courierState, CourierStateName } from '../domain/courier-state';
import { COURIER_TEXTS, courierLang } from '../domain/courier-texts';
import { CourierAssignmentService } from './courier-assignment.service';
import { CourierCardService } from './courier-card.service';
import { CourierShiftService } from './courier-shift.service';

export interface CourierView {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  /** The courier opened the invitation: the venue bot knows their Telegram */
  linked: boolean;
  state: CourierStateName;
  activeOrders: number;
  shift: { id: string; startedAt: string } | null;
  createdAt: string;
  disabledAt: string | null;
}

const LIST_INCLUDE = {
  shifts: { where: { status: 'open' }, take: 1 },
  _count: {
    select: {
      orders: { where: { status: { in: [...COURIER_HELD_STATUSES] } } },
    },
  },
} satisfies Prisma.courierInclude;

type CourierRow = Prisma.courierGetPayload<{ include: typeof LIST_INCLUDE }>;

function toView(c: CourierRow): CourierView {
  const shift = c.shifts[0] ?? null;
  const state = courierState(Boolean(shift), c._count.orders);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    isActive: c.is_active,
    linked: Boolean(c.telegram_user_id),
    state: state.state,
    activeOrders: state.activeOrders,
    shift: shift
      ? { id: shift.id, startedAt: shift.started_at.toISOString() }
      : null,
    createdAt: c.created_at.toISOString(),
    disabledAt: c.disabled_at?.toISOString() ?? null,
  };
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** The venue's couriers in the dashboard (owner and operator): docs/API.md, "Курьеры". */
@Injectable()
export class CourierService {
  private readonly logger = new Logger('Couriers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly assignments: CourierAssignmentService,
    private readonly shifts: CourierShiftService,
    private readonly cards: CourierCardService,
  ) {}

  async list(organizationId: string): Promise<CourierView[]> {
    const rows = await this.prisma.courier.findMany({
      where: { organization_id: organizationId },
      include: LIST_INCLUDE,
      orderBy: [{ is_active: 'desc' }, { created_at: 'asc' }],
    });
    return rows.map(toView);
  }

  async get(organizationId: string, id: string): Promise<CourierView> {
    const row = await this.prisma.courier.findFirst({
      where: { id, organization_id: organizationId },
      include: LIST_INCLUDE,
    });
    if (!row)
      throw new AppException('not_found', { message: 'Courier not found' });
    return toView(row);
  }

  async create(
    organizationId: string,
    input: { name: string; phone: string },
  ): Promise<CourierView> {
    try {
      const row = await this.prisma.courier.create({
        data: {
          organization_id: organizationId,
          name: input.name,
          phone: input.phone,
        },
        include: LIST_INCLUDE,
      });
      return toView(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppException('courier_phone_taken');
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    input: { name?: string; phone?: string },
  ): Promise<CourierView> {
    const current = await this.get(organizationId, id);
    if (!current.isActive) throw new AppException('courier_inactive');
    try {
      await this.prisma.courier.update({
        where: { id },
        data: { name: input.name, phone: input.phone },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppException('courier_phone_taken');
      throw e;
    }
    return this.get(organizationId, id);
  }

  /**
   * A one-time link to the venue bot, valid 24 hours; older unused links stop working. Needs a working venue
   * bot. The token is returned once, inside the link; only its hash is stored.
   */
  async invite(
    organizationId: string,
    id: string,
  ): Promise<{ link: string; expiresAt: string }> {
    const courier = await this.get(organizationId, id);
    if (!courier.isActive) throw new AppException('courier_inactive');
    const bot = await this.bots.forTenant(organizationId);
    if (!bot) throw new AppException('telegram_bot_required');

    const { token, hash } = newInviteToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + COURIER_INVITE_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.courier_invitation.updateMany({
        where: { courier_id: id, used_at: null, revoked_at: null },
        data: { revoked_at: now },
      }),
      this.prisma.courier_invitation.create({
        data: { courier_id: id, token_hash: hash, expires_at: expiresAt },
      }),
    ]);
    return {
      link: inviteLink(bot.username, token),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Disabling takes effect at once: the bot refuses the courier's buttons, open invitations are voided, the
   * unfinished orders are taken off and wait for another courier, an open shift ends (it still waits for the
   * cash reconciliation). There is no way back in the MVP: add the courier again.
   */
  async disable(
    organizationId: string,
    id: string,
    staffUserId: string,
  ): Promise<CourierView> {
    const courier = await this.prisma.courier.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!courier)
      throw new AppException('not_found', { message: 'Courier not found' });
    if (!courier.is_active) return this.get(organizationId, id);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.courier.update({
        where: { id },
        data: { is_active: false, disabled_at: now },
      }),
      this.prisma.courier_invitation.updateMany({
        where: { courier_id: id, used_at: null, revoked_at: null },
        data: { revoked_at: now },
      }),
    ]);
    await this.assignments.takeOffAll(id, staffUserId);
    await this.shifts.endOpen(id, { by: 'staff', userId: staffUserId });

    const bot = await this.bots.forTenant(organizationId);
    if (bot && courier.telegram_chat_id) {
      const t = COURIER_TEXTS[courierLang(courier.language_code)];
      // The courier is disabled either way; a message that did not go out is only logged
      await this.cards
        .say(bot, courier.telegram_chat_id, t.disabled, {
          remove_keyboard: true,
        })
        .catch((e) =>
          this.logger.warn(
            `Courier ${id} was not told about disabling: ${telegramErrorText(e)}`,
          ),
        );
    }
    return this.get(organizationId, id);
  }
}
