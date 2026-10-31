import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import {
  ChannelsDto,
  PublicationIncompleteErrorDto,
  PublicationViewDto,
  TelegramBotRequiredErrorDto,
} from './dto/publication.dto';
import { OrganizationService } from './services/organization.service';
import { PublicationService } from './services/publication.service';

type StaffRequest = Parameters<typeof requireStaffOrganizationId>[0];

/** Owner (dashboard): channels (QR menu, ordering) and publication of the venue. */
@ApiTags('Organization')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'No or invalid owner token' })
@ApiForbiddenResponse({ description: 'The user has no organization' })
@ApiNotFoundResponse({
  description: 'Not your organization (any other id looks missing)',
})
@Controller('organization')
export class OrganizationPublicationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly publication: PublicationService,
  ) {}

  private own(id: string, req: StaffRequest): string {
    const organizationId = requireStaffOrganizationId(req);
    this.organizations.assertOwn(id, organizationId);
    return organizationId;
  }

  @Get(':id/publication')
  @ApiOperation({
    summary: 'Publication state, channels and the readiness checklist',
  })
  @ApiOkResponse({ type: PublicationViewDto })
  get(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.publication.view(this.own(id, req));
  }

  @Put(':id/channels')
  @ApiOperation({
    summary:
      'Replace channels: QR menu and ordering (enabled, mode). Turning ordering off also unpublishes',
  })
  @ApiOkResponse({ type: PublicationViewDto })
  @ApiBadRequestResponse({
    description:
      'validation_error with errors[] (qr, delivery.enabled, delivery.mode)',
  })
  @ApiUnprocessableEntityResponse({
    type: TelegramBotRequiredErrorDto,
    description:
      'telegram_bot_required: mode miniapp or both without a connected, enabled venue bot',
  })
  setChannels(
    @Param('id') id: string,
    @Body() dto: ChannelsDto,
    @Req() req: StaffRequest,
  ) {
    return this.publication.setChannels(this.own(id, req), dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Publish: checks the checklist and opens orders. Already published: 200, publishedAt unchanged',
  })
  @ApiOkResponse({ type: PublicationViewDto })
  @ApiConflictResponse({
    type: PublicationIncompleteErrorDto,
    description: 'publication_incomplete: details.missing lists the todo items',
  })
  publish(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.publication.publish(this.own(id, req));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Pause: orders close, the QR menu keeps working, channels stay as they are. Repeating is fine',
  })
  @ApiOkResponse({ type: PublicationViewDto })
  unpublish(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.publication.unpublish(this.own(id, req));
  }
}
