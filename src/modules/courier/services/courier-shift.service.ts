import { Injectable, Logger } from '@nestjs/common';
import { CourierShiftStatus, Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { COURIER_HELD_STATUSES } from 'src/modules/order/domain/order-state-machine';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { telegramErrorText } from 'src/modules/telegram/telegram-client';
import { COURIER_TEXTS, courierLang } from '../domain/courier-texts';
import { CourierCardService } from './courier-card.service';

export interface ShiftView {
  id: string;
  courier: { id: string; name: string };
  status: CourierShiftStatus;
  startedAt: string;
  endedAt: string | null;
  /** courier (the bot button) or staff (closed in the dashboard, or the courier was disabled) */
  endedBy: 'courier' | 'staff' | null;
  activeOrders: number;
}

export type ShiftStart =
  | { kind: 'started'; shiftId: string }
  | { kind: 'already_open' };
export type ShiftEnd =
  | { kind: 'ended' }
  | { kind: 'not_open' }
  | { kind: 'has_orders'; activeOrders: number };

const INCLUDE = {
  courier: { select: { id: true, name: true } },
} satisfies Prisma.courier_shiftInclude;

/**
 * Courier shifts (docs/DELIVERY.md, "Смена"): the courier starts and ends one in the bot, the operator may
 * close it in the dashboard; a shift with unfinished orders cannot end. An ended shift waits for the cash
 * reconciliation (awaiting_reconciliation); the reconciliation itself is a later task.
 */
@Injectable()
export class CourierShiftService {
  private readonly logger = new Logger('CourierShifts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly cards: CourierCardService,
  ) {}

  async start(organizationId: string, courierId: string): Promise<ShiftStart> {
    try {
      const shift = await this.prisma.courier_shift.create({
        data: { organization_id: organizationId, courier_id: courierId },
      });
      return { kind: 'started', shiftId: shift.id };
    } catch (e) {
      // courier_shift_one_open_per_courier: a second press, or two presses at once
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return { kind: 'already_open' };
      throw e;
    }
  }

  activeOrders(courierId: string): Promise<number> {
    return this.prisma.customer_order.count({
      where: {
        courier_id: courierId,
        status: { in: [...COURIER_HELD_STATUSES] },
      },
    });
  }

  /** End the courier's open shift unless orders are still on them. */
  async end(
    courierId: string,
    by: { by: 'courier' | 'staff'; userId?: string },
  ): Promise<ShiftEnd> {
    const open = await this.prisma.courier_shift.findFirst({
      where: { courier_id: courierId, status: 'open' },
    });
    if (!open) return { kind: 'not_open' };
    const activeOrders = await this.activeOrders(courierId);
    if (activeOrders > 0) return { kind: 'has_orders', activeOrders };
    return this.close(open.id, by);
  }

  /** Disabling a courier: the shift ends even though orders were on it (they were just taken off). */
  async endOpen(
    courierId: string,
    by: { by: 'courier' | 'staff'; userId?: string },
  ): Promise<void> {
    const open = await this.prisma.courier_shift.findFirst({
      where: { courier_id: courierId, status: 'open' },
    });
    if (open) await this.close(open.id, by);
  }

  async list(
    organizationId: string,
    status?: CourierShiftStatus,
  ): Promise<ShiftView[]> {
    const rows = await this.prisma.courier_shift.findMany({
      where: { organization_id: organizationId, ...(status ? { status } : {}) },
      include: INCLUDE,
      orderBy: { started_at: 'desc' },
      take: 200,
    });
    const counts = await Promise.all(
      rows.map((r) =>
        r.status === 'open' ? this.activeOrders(r.courier_id) : 0,
      ),
    );
    return rows.map((r, i) => toShiftView(r, counts[i]));
  }

  /** The operator closes a courier's shift in the dashboard. */
  async closeByStaff(
    organizationId: string,
    shiftId: string,
    staffUserId: string,
  ): Promise<ShiftView> {
    const shift = await this.prisma.courier_shift.findFirst({
      where: { id: shiftId, organization_id: organizationId },
    });
    if (!shift)
      throw new AppException('not_found', { message: 'Shift not found' });
    if (shift.status === 'open') {
      const result = await this.end(shift.courier_id, {
        by: 'staff',
        userId: staffUserId,
      });
      if (result.kind === 'has_orders')
        throw new AppException('courier_has_active_orders', {
          details: { activeOrders: result.activeOrders },
        });
      if (result.kind === 'ended')
        await this.tellClosedByStaff(organizationId, shift.courier_id);
    }
    const fresh = await this.prisma.courier_shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: INCLUDE,
    });
    return toShiftView(fresh, 0);
  }

  private async tellClosedByStaff(organizationId: string, courierId: string) {
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
    });
    const bot = await this.bots.forTenant(organizationId);
    if (!courier?.telegram_chat_id || !bot) return;
    const t = COURIER_TEXTS[courierLang(courier.language_code)];
    try {
      await this.cards.say(bot, courier.telegram_chat_id, t.shiftClosedByStaff);
    } catch (e) {
      this.logger.warn(
        `Courier ${courierId} was not told about the closed shift: ${telegramErrorText(e)}`,
      );
    }
  }

  private async close(
    shiftId: string,
    by: { by: 'courier' | 'staff'; userId?: string },
  ): Promise<ShiftEnd> {
    // Conditional: a shift closed meanwhile (courier and operator at once) is not closed twice
    const updated = await this.prisma.courier_shift.updateMany({
      where: { id: shiftId, status: 'open' },
      data: {
        status: 'awaiting_reconciliation',
        ended_at: new Date(),
        ended_by: by.by,
        ended_by_user_id: by.userId ?? null,
      },
    });
    return updated.count ? { kind: 'ended' } : { kind: 'not_open' };
  }
}

function toShiftView(
  r: Prisma.courier_shiftGetPayload<{ include: typeof INCLUDE }>,
  activeOrders: number,
): ShiftView {
  return {
    id: r.id,
    courier: r.courier,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    endedBy: (r.ended_by as 'courier' | 'staff' | null) ?? null,
    activeOrders,
  };
}
