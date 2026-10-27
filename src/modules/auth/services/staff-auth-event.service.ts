import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { maskPhone } from 'src/infra/helper/auth/customer-validators';
import type { RequestCtx } from './customer-auth-event.service';

export type StaffAuthEventType =
  | 'staff_otp_requested'
  | 'staff_otp_send_failed'
  | 'staff_otp_failed'
  | 'staff_otp_locked'
  | 'staff_registered'
  | 'staff_login'
  | 'staff_login_failed'
  | 'staff_login_locked';

/** Owner auth audit: DB row + structured log. Codes, passwords, tokens and full phones are never written. */
@Injectable()
export class StaffAuthEventService {
  private readonly logger = new Logger('StaffAuthEvent');

  constructor(private readonly prisma: PrismaService) {}

  async log(
    type: StaffAuthEventType,
    ctx: RequestCtx,
    data: { userId?: string; organizationId?: string; phone?: string; meta?: Record<string, unknown> } = {},
  ): Promise<void> {
    const phone_masked = maskPhone(data.phone);
    this.logger.log(
      JSON.stringify({ type, user_id: data.userId, organization_id: data.organizationId, phone: phone_masked, ip: ctx.ip }),
    );
    try {
      await this.prisma.staff_auth_event.create({
        data: {
          type,
          user_id: data.userId ?? null,
          organization_id: data.organizationId ?? null,
          phone_masked,
          ip: ctx.ip || null,
          user_agent: ctx.userAgent || null,
          meta: (data.meta as any) ?? undefined,
        },
      });
    } catch (err: any) {
      // A failed audit write must not break authentication
      this.logger.warn(`audit not written: ${err?.message}`);
    }
  }
}
