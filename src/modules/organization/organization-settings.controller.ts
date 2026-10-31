import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { OrganizationSettingsDto } from './dto/organization-settings.dto';
import {
  OrganizationSettings,
  resolveTheme,
} from './domain/organization-settings';
import { OrganizationService } from './services/organization.service';
import { OrganizationSettingsService } from './services/organization-settings.service';

type StaffRequest = Parameters<typeof requireStaffOrganizationId>[0];

/** The answer carries the full theme (stored over platform defaults) for the dashboard preview. */
const withEffectiveTheme = (s: OrganizationSettings) => ({
  ...s,
  effectiveTheme: resolveTheme(s.theme),
});

/** Owner (dashboard): brand colors, languages, currency, contacts and map of the venue. */
@ApiTags('Organization')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'No or invalid owner token' })
@ApiForbiddenResponse({ description: 'The user has no organization' })
@ApiNotFoundResponse({
  description: 'Not your organization (any other id looks missing)',
})
@Controller('organization')
export class OrganizationSettingsController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  @Get(':id/settings')
  @ApiOperation({ summary: 'Venue settings (your own organization only)' })
  @ApiOkResponse({ type: OrganizationSettingsDto })
  get(@Param('id') id: string, @Req() req: StaffRequest) {
    const organizationId = requireStaffOrganizationId(req);
    this.organizations.assertOwn(id, organizationId);
    return this.settings.get(organizationId).then(withEffectiveTheme);
  }

  @Put(':id/settings')
  @ApiOperation({
    summary: 'Replace venue settings: send every field, null clears it',
  })
  @ApiOkResponse({ type: OrganizationSettingsDto })
  @ApiBadRequestResponse({
    description:
      'Invalid field (colors, languages, coordinates, zoom, bounds) or invalid_settings: defaultLanguage outside languages, foundedYear in the future, mapCenter outside mapBounds',
  })
  replace(
    @Param('id') id: string,
    @Body() dto: OrganizationSettingsDto,
    @Req() req: StaffRequest,
  ) {
    const organizationId = requireStaffOrganizationId(req);
    this.organizations.assertOwn(id, organizationId);
    return this.settings.replace(organizationId, dto).then(withEffectiveTheme);
  }
}
