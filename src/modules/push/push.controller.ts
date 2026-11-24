import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import { platformMisconfigured } from 'src/infra/errors/app-exception';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import {
  PushPublicKeyDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
} from './dto/push-subscription.dto';
import { PushSubscriptionService } from './push-subscription.service';
import { WEB_PUSH_SENDER, type PushSender } from './web-push.sender';

/**
 * Web push to owners and operators (docs/API.md, "Web push сотрудникам"): the dashboard subscribes the browser
 * after sign-in and unsubscribes it on sign-out. Same right as the order list: the notifications are about orders.
 */
@ApiTags('Web push (staff)')
@ApiBearerAuth('access-token')
@Controller('push')
export class PushController {
  constructor(
    private readonly subscriptions: PushSubscriptionService,
    @Inject(WEB_PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  @StaffAccess('orders')
  @Get('public-key')
  @ApiOperation({ summary: 'VAPID public key for pushManager.subscribe' })
  @ApiOkResponse({ type: PushPublicKeyDto })
  @ApiServiceUnavailableResponse({
    type: ErrorResponse,
    description:
      'platform_misconfigured, details.feature = web_push: no VAPID keys on the platform',
  })
  publicKey(): PushPublicKeyDto {
    const key = this.sender.publicKey;
    if (!key)
      throw platformMisconfigured('web_push', 'the VAPID keys are not set');
    return { publicKey: key };
  }

  @StaffAccess('orders')
  @Post('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Save the browser subscription for the signed-in staff member (upsert by endpoint: the same endpoint moves to this user)',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'validation_error',
  })
  async subscribe(
    @Req() req: StaffRequest,
    @Body() dto: PushSubscribeDto,
  ): Promise<void> {
    await this.subscriptions.subscribe(
      req.user.id,
      requireStaffOrganizationId(req),
      {
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent,
      },
    );
  }

  @StaffAccess('orders')
  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Remove this user's subscription by endpoint (another user's or an unknown endpoint: the same 204, nothing removed)",
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'validation_error',
  })
  async unsubscribe(
    @Req() req: StaffRequest,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<void> {
    await this.subscriptions.unsubscribe(req.user.id, dto.endpoint);
  }
}
