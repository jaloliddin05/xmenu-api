import { Body, Controller, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';
import { parseTenantId } from 'src/modules/tenant/tenant-key';
import { CLICK_ERROR, ClickProtocol } from '../domain/click-protocol';
import type { ClickRequest } from '../domain/click-protocol';
import { PaymentConfigService } from '../services/payment-config.service';
import { PrismaClickStore } from '../stores/prisma-click.store';

/**
 * Click Shop API webhook'lari. URL'da tenant id'si (organization UUID) bor — Click kabinetida
 * har restoran o'z xizmati uchun shu manzilni kiritadi (id o'zgarmaydi, slug esa o'zgarishi mumkin):
 *   Prepare:  POST {API}/payments/click/{tenantId}/prepare
 *   Complete: POST {API}/payments/click/{tenantId}/complete
 * Imzo tenantning o'z secret_key'i bilan tekshiriladi. Javob doim HTTP 200
 * (Click xatoni `error` maydonidan o'qiydi).
 */
@ApiExcludeController()
@Public()
@SkipPublicRateLimit()
@Controller('payments/click/:tenantId')
export class ClickController {
  private readonly logger = new Logger('Click');

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: PaymentConfigService,
    private readonly transitions: OrderTransitionService,
  ) {}

  @Post('prepare')
  @HttpCode(200)
  prepare(@Param('tenantId') tenantId: string, @Body() body: ClickRequest) {
    return this.handle('prepare', tenantId, body);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Param('tenantId') tenantId: string, @Body() body: ClickRequest) {
    return this.handle('complete', tenantId, body);
  }

  private async handle(action: 'prepare' | 'complete', tenantId: string, body: ClickRequest) {
    const fail = (error: number, note: string) => ({
      click_trans_id: String(body?.click_trans_id ?? ''),
      merchant_trans_id: String(body?.merchant_trans_id ?? ''),
      error,
      error_note: note,
    });

    try {
      const id = parseTenantId(tenantId);
      const org = id ? await this.prisma.organization.findUnique({ where: { id }, select: { id: true, is_active: true } }) : null;
      const cfg = org?.is_active ? await this.configs.getClick(org.id) : null;
      if (!org || !cfg) return fail(CLICK_ERROR.BAD_REQUEST, 'Merchant is not configured');

      const protocol = new ClickProtocol(new PrismaClickStore(this.prisma, this.transitions, org.id), cfg);
      return await protocol.handle(action, body ?? {});
    } catch (e: any) {
      this.logger.error(`${action} failed: ${e?.stack ?? e}`);
      return fail(CLICK_ERROR.FAILED_TO_UPDATE, 'Failed to update user');
    }
  }
}
