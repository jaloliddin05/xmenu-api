import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import { Body, Controller, Headers, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';
import { parseTenantId } from 'src/modules/tenant/tenant-key';
import { PAYME_ERROR, PaymeProtocol, PaymeRpcError, verifyPaymeAuth } from '../domain/payme-protocol';
import type { RpcRequest } from '../domain/payme-protocol';
import { PaymentConfigService } from '../services/payment-config.service';
import { PrismaPaymeStore } from '../stores/prisma-payme.store';

/**
 * Payme Merchant API (JSON-RPC). Payme kabinetida endpoint:
 *   POST {API}/payments/payme/{tenantId}
 * {tenantId} — organization UUID (o'zgarmaydi, slug esa o'zgarishi mumkin).
 * Avtorizatsiya: Basic base64("Paycom:<tenant kaliti>"). Har bir javob HTTP 200;
 * xatolar JSON-RPC `error` ichida.
 */
@ApiExcludeController()
@Public()
@SkipPublicRateLimit()
@Controller('payments/payme/:tenantId')
export class PaymeController {
  private readonly logger = new Logger('Payme');

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: PaymentConfigService,
    private readonly transitions: OrderTransitionService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Param('tenantId') tenantId: string, @Headers('authorization') auth: string | undefined, @Body() body: RpcRequest) {
    const id = body?.id ?? null;
    const err = (code: number) => ({ id, error: new PaymeRpcError(code).toJSON() });

    try {
      const orgId = parseTenantId(tenantId);
      const org = orgId ? await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, is_active: true } }) : null;
      const cfg = org?.is_active ? await this.configs.getPayme(org.id) : null;
      // Noma'lum tenant va noto'g'ri parol bir xil javob beradi — tenantlar ro'yxatini sezdirmaymiz.
      if (!org || !cfg || !verifyPaymeAuth(auth, cfg.key)) return err(PAYME_ERROR.INSUFFICIENT_PRIVILEGE);

      return await new PaymeProtocol(new PrismaPaymeStore(this.prisma, this.transitions, org.id)).handle(body);
    } catch (e: any) {
      this.logger.error(`${body?.method} failed: ${e?.stack ?? e}`);
      return err(PAYME_ERROR.SYSTEM_ERROR);
    }
  }
}
