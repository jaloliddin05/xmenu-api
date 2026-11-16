import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { courierReport } from './domain/courier-report';
import { externalReport } from './domain/external-report';
import { problemReport } from './domain/problem-report';
import { ReportPeriod, inPeriod } from './domain/report-period';

const period = (p: ReportPeriod) => ({
  from: p.from.toISOString(),
  to: p.to.toISOString(),
});

/** Delivery reports for the owner (docs/API.md, "Отчёты"): couriers, external services, problems. */
@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Shifts started in the period (a night shift belongs to the day it started) and their delivered orders. */
  async couriers(organizationId: string, p: ReportPeriod, now = new Date()) {
    const shifts = await this.prisma.courier_shift.findMany({
      where: { organization_id: organizationId, started_at: inPeriod(p) },
      include: { courier: { select: { name: true } } },
    });
    const orders = shifts.length
      ? await this.prisma.customer_order.findMany({
          where: {
            organization_id: organizationId,
            courier_shift_id: { in: shifts.map((s) => s.id) },
            status: 'completed',
          },
          select: {
            courier_shift_id: true,
            status: true,
            payment_method: true,
            cash_collected: true,
            total: true,
            courier_pay: true,
          },
        })
      : [];
    return {
      ...period(p),
      ...courierReport(
        shifts.map((s) => ({ ...s, courierName: s.courier.name })),
        orders,
        now,
      ),
    };
  }

  /** Orders handed to external services in the period. */
  async external(organizationId: string, p: ReportPeriod) {
    const orders = await this.prisma.customer_order.findMany({
      where: {
        organization_id: organizationId,
        status: 'handed_to_external',
        external_handed_at: inPeriod(p),
      },
      select: {
        external_service: true,
        external_cost: true,
        external_handed_at: true,
        payment_method: true,
        external_cash_received: true,
        total: true,
      },
    });
    return { ...period(p), ...externalReport(orders) };
  }

  /** Delivery problems from the order journal in the period, and delivery orders cancelled in it. */
  async problems(organizationId: string, p: ReportPeriod) {
    const delivery = {
      organization_id: organizationId,
      fulfillment: 'delivery' as const,
    };
    const [events, cancelled] = await Promise.all([
      this.prisma.order_status_event.findMany({
        where: {
          created_at: inPeriod(p),
          to_status: {
            in: ['problem_at_door', 'ready', 'returned_to_restaurant'],
          },
          order: delivery,
        },
        select: { from_status: true, to_status: true, actor: true, note: true },
      }),
      this.prisma.customer_order.findMany({
        where: { ...delivery, status: 'cancelled', cancelled_at: inPeriod(p) },
        select: { cancelled_by: true, cancel_reason: true },
      }),
    ]);
    return { ...period(p), ...problemReport(events, cancelled) };
  }
}
