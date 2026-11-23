import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppException } from 'src/infra/errors/app-exception';
import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { RegionDto, RegionListDto } from '../dto/delivery-area.dto';
import { RegionCatalog } from '../regions/region-catalog';

/** Owner (dashboard): the catalog of regions a venue delivery area can take whole (ISO 3166-2:UZ). */
@ApiTags('Delivery')
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
@Controller('delivery/regions')
export class DeliveryRegionsController {
  constructor(private readonly catalog: RegionCatalog) {}

  @StaffAccess('venue')
  @Get()
  @ApiOperation({
    summary:
      'Regions of Uzbekistan: code, names (uz, ru, en) and bbox, with the catalog version and the attribution to show',
  })
  @ApiOkResponse({ type: RegionListDto })
  list(): RegionListDto {
    return {
      version: this.catalog.version,
      attribution: this.catalog.attribution,
      license: this.catalog.license,
      regions: this.catalog.list().map((r) => ({
        code: r.code,
        name: { ...r.name },
        bbox: r.bbox,
      })),
    };
  }

  @StaffAccess('venue')
  @Get(':code')
  @ApiOperation({ summary: 'Geometry of one region (rings, even-odd)' })
  @ApiOkResponse({ type: RegionDto })
  @ApiNotFoundResponse({
    type: ErrorResponse,
    description: 'not_found: no such region code',
  })
  get(@Param('code') code: string): RegionDto {
    const r = this.catalog.find(code);
    if (!r) throw new AppException('not_found', { message: 'No such region' });
    return {
      code: r.code,
      name: { ...r.name },
      bbox: r.bbox,
      version: this.catalog.version,
      rings: r.rings,
    };
  }
}
