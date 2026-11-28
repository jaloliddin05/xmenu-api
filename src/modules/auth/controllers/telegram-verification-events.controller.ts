import { Controller, Get, Headers, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppException } from 'src/infra/errors/app-exception';
import { requestCtx } from 'src/infra/http/request-helpers';
import { LiveStreamService } from 'src/modules/live/live-stream.service';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { CurrentTenant } from '../../tenant/current-tenant.decorator';
import { CustomerPublicRoute } from '../decorators/customer-route.decorator';
import {
  TelegramVerificationService,
  verificationStreamKey,
} from '../services/telegram-verification.service';

/**
 * The phone confirmation through the venue bot moves on in Telegram, outside the page: this stream tells the page
 * when, and the page asks POST /auth/customer/telegram/status once (the login is still handed out only there).
 * The session id goes in a header, never in the URL. docs/TELEGRAM_VERIFICATION.md.
 */
@ApiTags('Events (SSE)')
@Controller('events')
export class TelegramVerificationEventsController {
  constructor(
    private readonly verification: TelegramVerificationService,
    private readonly streams: LiveStreamService,
  ) {}

  @CustomerPublicRoute()
  @Get('telegram-verification')
  @ApiOperation({
    summary:
      'Stream of one Telegram verification session: verification.changed, then one status call (text/event-stream)',
  })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiHeader({
    name: 'X-Verification-Session',
    required: true,
    description: 'sessionId from POST /auth/customer/telegram/start',
  })
  async stream(
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-verification-session') sessionId?: string,
  ): Promise<void> {
    const endsAt = sessionId
      ? await this.verification.sessionEndsAt(tenant.id, sessionId)
      : null;
    if (!sessionId || !endsAt) throw new AppException('not_found');
    const key = verificationStreamKey(sessionId);
    await this.streams.serve(req, res, {
      audience: 'verification',
      orgId: tenant.id,
      accept: (e) => e.session === key,
      view: () => ({}),
      // The session ends: the page shows "expired" by its own countdown, the stream has nothing more to say
      expiresAt: endsAt,
      limits: { ip: requestCtx(req).ip },
    });
    if (!res.headersSent) throw new AppException('internal_error');
  }
}
