import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { maskPhone } from 'src/infra/helper/auth/customer-validators';

export type AuthEventType =
  | 'otp_requested'
  | 'otp_send_failed'
  | 'otp_verified'
  | 'otp_failed'
  | 'otp_locked'
  | 'registered'
  | 'login'
  | 'refresh'
  | 'refresh_reuse_detected'
  | 'logout'
  | 'customer_blocked_attempt';

export interface RequestCtx {
  ip: string;
  userAgent: string;
}

/** Audit: DB'ga + strukturalangan log. Kod, token va to'liq telefon HECH QACHON yozilmaydi. */
@Injectable()
export class CustomerAuthEventService {
  private readonly logger = new Logger('CustomerAuthEvent');

  constructor(private readonly prisma: PrismaService) {}

  async log(
    type: AuthEventType,
    ctx: RequestCtx,
    data: { tenantId?: string; customerId?: string; phone?: string; meta?: Record<string, unknown> } = {},
  ): Promise<void> {
    const phone_masked = maskPhone(data.phone);
    this.logger.log(
      JSON.stringify({
        type,
        tenant_id: data.tenantId,
        customer_id: data.customerId,
        phone: phone_masked,
        ip: ctx.ip,
      }),
    );
    try {
      await this.prisma.customer_auth_event.create({
        data: {
          type,
          organization_id: data.tenantId ?? null,
          customer_id: data.customerId ?? null,
          phone_masked,
          ip: ctx.ip || null,
          user_agent: ctx.userAgent || null,
          meta: (data.meta as any) ?? undefined,
        },
      });
    } catch (err: any) {
      // Audit yozuvi xatosi autentifikatsiyani buzmasligi kerak
      this.logger.warn(`audit yozilmadi: ${err?.message}`);
    }
  }
}
