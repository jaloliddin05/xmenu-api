import {
  Controller,
  Get,
  Headers,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { decode } from 'jsonwebtoken';
import { AppException } from 'src/infra/errors/app-exception';
import {
  requestCtx,
  requireStaffOrganizationId,
} from 'src/infra/http/request-helpers';
import type { StaffRequest } from 'src/infra/http/request-helpers';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import {
  CurrentCustomer,
  CustomerProtectedRoute,
  CustomerPublicRoute,
} from 'src/modules/auth/decorators/customer-route.decorator';
import type { CustomerPrincipal } from 'src/modules/auth/decorators/customer-route.decorator';
import { sseComment } from './live-events';
import type { LiveEnvelope } from './live-events';
import { LiveStreamService } from './live-stream.service';

const LAST_EVENT_ID = {
  name: 'Last-Event-ID',
  required: false,
  description:
    'Id of the last event the client got: missed events are replayed (up to 5 minutes), older ids get `resync`',
};

/** Expiry of the verified bearer token of this request (ms), undefined when it carries none. */
export function tokenExpiry(
  authorization: string | undefined,
): number | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const payload = token ? decode(token) : null;
  return payload &&
    typeof payload === 'object' &&
    typeof payload.exp === 'number'
    ? payload.exp * 1000
    : undefined;
}

/** A stream that did not start answers like any failed request instead of hanging (@Res takes the answer over). */
function answered(res: Response) {
  if (!res.headersSent) throw new AppException('internal_error');
}

/** The guest sees the status of their order, nothing about branches or couriers. */
const guestView = (e: LiveEnvelope) => ({
  orderId: e.data.orderId,
  status: e.data.status,
  version: e.data.version,
});

/**
 * Server-sent event streams (docs/API.md, "События (SSE)"). The client reads them with fetch and a ReadableStream,
 * the token goes in the Authorization header (never in the URL). Events are thin: the client refetches.
 */
@ApiTags('Events (SSE)')
@Controller('events')
export class LiveEventsController {
  constructor(
    private readonly streams: LiveStreamService,
    private readonly prisma: PrismaService,
  ) {}

  @StaffAccess('orders')
  @Get('staff')
  @ApiOperation({
    summary:
      'Stream of the venue for the dashboard: orders, couriers, venue data, iiko (text/event-stream)',
  })
  @ApiProduces('text/event-stream')
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Only events of this branch (and events of the whole venue)',
  })
  @ApiHeader(LAST_EVENT_ID)
  async staff(
    @Req() req: Request & StaffRequest & { user: { sid: string } },
    @Res() res: Response,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    const orgId = requireStaffOrganizationId(req);
    if (branchId) {
      const own = await this.prisma.branch.findFirst({
        where: { id: branchId, organization_id: orgId },
        select: { id: true },
      });
      if (!own) throw new AppException('not_found');
    }
    // An operator bound to a branch would be filtered here as well (no such binding yet, see GET /order/board)
    await this.streams.serve(req, res, {
      audience: 'staff',
      orgId,
      accept: (e) => !branchId || !e.branchId || e.branchId === branchId,
      view: (e) => (e.origin ? { ...e.data, origin: e.origin } : e.data),
      lastEventId,
      expiresAt: tokenExpiry(req.headers.authorization),
      revoke: { kind: 'staff', sid: req.user.sid },
      limits: { user: req.user.id, ip: requestCtx(req).ip },
    });
    answered(res);
  }

  @CustomerProtectedRoute()
  @Get('guest')
  @ApiOperation({
    summary:
      "Stream of the guest's own orders in this venue (text/event-stream)",
  })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiHeader(LAST_EVENT_ID)
  async guest(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentCustomer() me: CustomerPrincipal,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    await this.streams.serve(req, res, {
      audience: 'guest',
      orgId: me.tenantId,
      accept: (e) => e.customerId === me.customerId,
      view: guestView,
      lastEventId,
      expiresAt: tokenExpiry(req.headers.authorization),
      revoke: { kind: 'guest', sid: me.sid },
      limits: {
        guest: `${me.tenantId}:${me.customerId}`,
        ip: requestCtx(req).ip,
      },
    });
    answered(res);
  }

  @CustomerPublicRoute()
  @Get('public')
  @ApiOperation({
    summary:
      'Stream of public venue data for open guest pages: menu, settings, branches (text/event-stream)',
  })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiHeader(LAST_EVENT_ID)
  async publicStream(
    @Req() req: Request & { tenant: { id: string } },
    @Res() res: Response,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    await this.streams.serve(req, res, {
      audience: 'public',
      orgId: req.tenant.id,
      lastEventId,
      limits: { ip: requestCtx(req).ip },
    });
    answered(res);
  }

  /** For smoke.sh: proves the path through the proxy is not buffered, without a token. */
  @Public()
  @Get('ping')
  @ApiOperation({
    summary: 'Two ping comments two seconds apart, then the end (proxy check)',
  })
  @ApiProduces('text/event-stream')
  ping(@Req() req: Request, @Res() res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(sseComment('ping'));
    const timer = setTimeout(() => {
      res.write(sseComment('ping'));
      res.end();
    }, 2_000);
    req.on('close', () => clearTimeout(timer));
  }
}
