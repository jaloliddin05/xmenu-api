import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';

/**
 * Courier functions of Xmenu (couriers, shifts and cash, assignment, external service, courier
 * report) are off for a venue whose couriers are managed in iiko (docs/IIKO.md, "Курьеры"):
 * 409 pos_couriers_managed. Runs after the staff access guard, so the venue is the caller's.
 */
@Injectable()
export class OwnCouriersGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: { organization?: { id?: string } | null } }>();
    const organizationId = req.user?.organization?.id;
    if (!organizationId) return true;
    if (await couriersInPos(this.prisma, organizationId))
      throw new AppException('pos_couriers_managed');
    return true;
  }
}

/** The venue's couriers work in iiko (an enabled integration in courier mode "iiko"). */
export async function couriersInPos(
  prisma: Pick<PrismaService, 'pos_integration'>,
  organizationId: string,
): Promise<boolean> {
  const row = await prisma.pos_integration.findUnique({
    where: { organization_id: organizationId },
    select: { status: true, courier_mode: true },
  });
  return !!row && row.status !== 'draft' && row.courier_mode === 'iiko';
}
