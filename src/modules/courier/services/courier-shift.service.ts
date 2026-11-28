import { Injectable, Logger, Optional } from '@nestjs/common';
import { CourierShiftStatus, Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { COURIER_HELD_STATUSES } from 'src/modules/order/domain/order-state-machine';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { telegramErrorText } from 'src/modules/telegram/telegram-client';
import { COURIER_TEXTS, courierLang } from '../domain/courier-texts';
import {
  ShiftCash,
  ShiftOrder,
  cashDiscrepancy,
  shiftCash,
} from '../domain/shift-cash';
import { CourierCardService } from './courier-card.service';
import { LiveEventBus } from 'src/modules/live/live-event-bus';

export interface ShiftView {
  id: string;
  courier: { id: string; name: string };
  status: CourierShiftStatus;
  startedAt: string;
  endedAt: string | null;
  /** courier (the bot button) or staff (closed in the dashboard, or the courier was disabled) */
  endedBy: 'courier' | 'staff' | null;
  activeOrders: number;
  /** Cash of the shift: live until the reconciliation, fixed by it */
  cash: ShiftCash & { received: number | null; discrepancy: number | null };
  reconciledAt: string | null;
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
 * reconciliation (awaiting_reconciliation): the operator enters what they got once, the shift keeps the sum
 * due, the sum received and the discrepancy (reconciled).
 */
@Injectable()
export class CourierShiftService {
  private readonly logger = new Logger('CourierShifts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly cards: CourierCardService,
    @Optional() private readonly live?: LiveEventBus,
  ) {}

  async start(organizationId: string, courierId: string): Promise<ShiftStart> {
    try {
      const shift = await this.prisma.courier_shift.create({
        data: { organization_id: organizationId, courier_id: courierId },
      });
      await this.changed(organizationId);
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
    const cash = await this.cashOf(rows.map((r) => r.id));
    return rows.map((r, i) => toShiftView(r, counts[i], cash.get(r.id)));
  }

  async get(organizationId: string, shiftId: string): Promise<ShiftView> {
    const shift = await this.prisma.courier_shift.findFirst({
      where: { id: shiftId, organization_id: organizationId },
      include: INCLUDE,
    });
    if (!shift)
      throw new AppException('not_found', { message: 'Shift not found' });
    const active =
      shift.status === 'open' ? await this.activeOrders(shift.courier_id) : 0;
    const cash = await this.cashOf([shift.id]);
    return toShiftView(shift, active, cash.get(shift.id));
  }

  /**
   * The operator enters the cash they got from the courier, once per ended shift. "Due" is fixed at this
   * moment; the discrepancy (received - due) stays in the shift and goes to the reports.
   */
  async reconcile(
    organizationId: string,
    shiftId: string,
    received: number,
    staffUserId: string,
  ): Promise<ShiftView> {
    const shift = await this.prisma.courier_shift.findFirst({
      where: { id: shiftId, organization_id: organizationId },
    });
    if (!shift)
      throw new AppException('not_found', { message: 'Shift not found' });
    const { due } =
      (await this.cashOf([shiftId])).get(shiftId) ?? shiftCash([]);
    // Conditional: a second reconciliation (or two operators at once) changes nothing
    const updated = await this.prisma.courier_shift.updateMany({
      where: { id: shiftId, status: 'awaiting_reconciliation' },
      data: {
        status: 'reconciled',
        cash_due: due,
        cash_received: received,
        cash_discrepancy: cashDiscrepancy(received, due),
        reconciled_at: new Date(),
        reconciled_by_user_id: staffUserId,
      },
    });
    if (updated.count === 0)
      throw new AppException('shift_not_awaiting_reconciliation', {
        details: { status: shift.status },
      });
    return this.get(organizationId, shiftId);
  }

  /** Deliveries, cash due and card per shift, from the delivered orders of the shifts. */
  private async cashOf(shiftIds: string[]): Promise<Map<string, ShiftCash>> {
    const orders = shiftIds.length
      ? await this.prisma.customer_order.findMany({
          where: { courier_shift_id: { in: shiftIds }, status: 'completed' },
          select: {
            courier_shift_id: true,
            status: true,
            payment_method: true,
            cash_collected: true,
            total: true,
          },
        })
      : [];
    const byShift = new Map<string, ShiftOrder[]>();
    for (const o of orders) {
      const list = byShift.get(o.courier_shift_id!) ?? [];
      list.push(o);
      byShift.set(o.courier_shift_id!, list);
    }
    return new Map(
      shiftIds.map((id) => [id, shiftCash(byShift.get(id) ?? [])]),
    );
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
    return this.get(organizationId, shiftId);
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
    if (!updated.count) return { kind: 'not_open' };
    const shift = await this.prisma.courier_shift.findUnique({
      where: { id: shiftId },
      select: { organization_id: true },
    });
    if (shift) await this.changed(shift.organization_id);
    return { kind: 'ended' };
  }

  /** Shifts started and ended in the courier bot reach the open dashboard (docs/API.md, "События (SSE)"). */
  private async changed(organizationId: string) {
    await this.live?.publish(organizationId, {
      type: 'courier.changed',
      data: {},
      to: ['staff'],
    });
  }
}

function toShiftView(
  r: Prisma.courier_shiftGetPayload<{ include: typeof INCLUDE }>,
  activeOrders: number,
  live: ShiftCash = shiftCash([]),
): ShiftView {
  const reconciled = r.status === 'reconciled';
  return {
    id: r.id,
    courier: r.courier,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    endedBy: (r.ended_by as 'courier' | 'staff' | null) ?? null,
    activeOrders,
    cash: {
      ...live,
      due: reconciled ? (r.cash_due ?? live.due) : live.due,
      received: reconciled ? r.cash_received : null,
      discrepancy: reconciled ? r.cash_discrepancy : null,
    },
    reconciledAt: r.reconciled_at?.toISOString() ?? null,
  };
}
