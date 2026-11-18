import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReportController } from '../report/report.controller';
import {
  CourierController,
  CourierShiftController,
  ExternalServiceController,
  OrderCourierController,
} from './courier.controller';
import { OwnCouriersGuard } from './own-couriers.guard';

const ctx = (organizationId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: organizationId ? { organization: { id: organizationId } } : {},
      }),
    }),
  }) as any;

describe('OwnCouriersGuard (docs/IIKO.md, "Курьеры")', () => {
  const guard = (row: { status: string; courier_mode: string } | null) =>
    new OwnCouriersGuard({
      pos_integration: { findUnique: jest.fn(async () => row) },
    } as any);

  it('couriers in iiko: courier functions of Xmenu answer 409 pos_couriers_managed', async () => {
    await expect(
      guard({ status: 'active', courier_mode: 'iiko' }).canActivate(ctx('org')),
    ).rejects.toMatchObject({ code: 'pos_couriers_managed' });
    // "needs reconnect" is still an iiko venue
    await expect(
      guard({ status: 'needs_reconnect', courier_mode: 'iiko' }).canActivate(
        ctx('org'),
      ),
    ).rejects.toMatchObject({ code: 'pos_couriers_managed' });
  });

  it.each([
    ['no iiko', null],
    ['own couriers with iiko', { status: 'active', courier_mode: 'xmenu' }],
    ['iiko not enabled yet', { status: 'draft', courier_mode: 'iiko' }],
  ])('%s: open', async (_label, row) => {
    await expect(guard(row).canActivate(ctx('org'))).resolves.toBe(true);
  });

  it('guards the couriers, shifts, assignment, external service and the courier report', () => {
    const guarded = (target: object) =>
      (
        (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? []
      ).includes(OwnCouriersGuard);
    for (const cls of [
      CourierController,
      CourierShiftController,
      ExternalServiceController,
    ])
      expect(guarded(cls)).toBe(true);
    const order = OrderCourierController.prototype as unknown as Record<
      string,
      object
    >;
    const methods = Object.getOwnPropertyNames(order).filter(
      (m) => m !== 'constructor',
    );
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(guarded(order[m])).toBe(true);
    const reports = ReportController.prototype as unknown as Record<
      string,
      object
    >;
    expect(guarded(reports.couriers)).toBe(true);
    expect(guarded(reports.external)).toBe(false);
  });
});
