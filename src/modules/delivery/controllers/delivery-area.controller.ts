import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { DeliveryAreaDto, DeliveryAreaViewDto } from '../dto/delivery-area.dto';
import { DeliveryAreaService } from '../services/delivery-area.service';

/** Owner (dashboard): the venue delivery area and its default price (docs/DELIVERY.md). */
@ApiTags('Organization')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  type: ErrorResponse,
  description: 'No or invalid owner token',
})
@ApiForbiddenResponse({
  type: ErrorResponse,
  description:
    'The user has no organization, or the role lacks the venue permission',
})
@ApiNotFoundResponse({
  type: ErrorResponse,
  description: 'Not your organization (any other id looks missing)',
})
@Controller('organization')
export class DeliveryAreaController {
  constructor(private readonly area: DeliveryAreaService) {}

  @StaffAccess('venue', { orgParam: 'id' })
  @Get(':id/delivery-area')
  @ApiOperation({
    summary:
      'Venue delivery area: parts (catalog regions with their copied geometry, drawn outlines) and the default price',
  })
  @ApiOkResponse({ type: DeliveryAreaViewDto })
  get(@Param('id') _id: string, @Req() req: StaffRequest) {
    return this.area.get(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue', { orgParam: 'id' })
  @Put(':id/delivery-area')
  @ApiOperation({
    summary:
      'Replace the venue delivery area: parts ({ source: region, code } or { source: custom, polygon }) and the default price; no parts removes the area. JSON body up to 1 MB (delivery-area.body.ts)',
  })
  @ApiOkResponse({ type: DeliveryAreaViewDto })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'validation_error, or invalid_settings with fields[]: unknown_region, duplicate, polygon, outside_bounds, self_intersection, array_max_size (parts), required (defaultRule)',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponse,
    description: 'payload_too_large: the body is over 1 MB',
  })
  replace(
    @Param('id') _id: string,
    @Body() dto: DeliveryAreaDto,
    @Req() req: StaffRequest,
  ) {
    return this.area.replace(requireStaffOrganizationId(req), dto);
  }
}
