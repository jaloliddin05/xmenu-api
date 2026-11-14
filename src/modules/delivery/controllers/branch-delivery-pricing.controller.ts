import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
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
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import {
  DeliveryPointQueryDto,
  DeliveryPriceCheckDto,
  DeliveryPricingDto,
  DeliveryPricingViewDto,
} from '../dto/delivery-pricing.dto';
import { DeliveryPricingService } from '../services/delivery-pricing.service';
import { DeliveryQuoteService } from '../services/delivery-quote.service';

/** Owner (dashboard): delivery pricing of a branch and "what does delivery to this address cost". */
@ApiTags('Branch')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'No or invalid owner token' })
@ApiForbiddenResponse({ description: 'The user has no organization' })
@ApiNotFoundResponse({
  description: 'Not your branch (another venue’s branch looks missing)',
})
@Controller('branch')
export class BranchDeliveryPricingController {
  constructor(
    private readonly pricing: DeliveryPricingService,
    private readonly quotes: DeliveryQuoteService,
  ) {}

  @Get(':id/delivery-pricing')
  @ApiOperation({
    summary: 'Delivery pricing of the branch: zones and distance rule',
  })
  @ApiOkResponse({ type: DeliveryPricingViewDto })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    return this.pricing.get(requireStaffOrganizationId(req), id);
  }

  @Put(':id/delivery-pricing')
  @ApiOperation({
    summary:
      'Replace the delivery pricing of the branch (zones in priority order, distance rule or null)',
  })
  @ApiOkResponse({ type: DeliveryPricingViewDto })
  @ApiBadRequestResponse({
    description:
      'validation_error, or invalid_settings: a polygon is not [[lat, lng], ...] or maxKm < includedKm',
  })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveryPricingDto,
    @Req() req: StaffRequest,
  ) {
    return this.pricing.replace(requireStaffOrganizationId(req), id, dto);
  }

  @Get(':id/delivery-pricing/check')
  @ApiOperation({
    summary:
      'Delivery price from this branch to a point by its saved rules and the venue step (hours not considered)',
  })
  @ApiOkResponse({ type: DeliveryPriceCheckDto })
  check(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DeliveryPointQueryDto,
    @Req() req: StaffRequest,
  ) {
    return this.quotes.check(
      requireStaffOrganizationId(req),
      id,
      [q.lat, q.lng],
      q.subtotal ?? 0,
    );
  }
}
