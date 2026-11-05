import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import type { StaffRequest } from 'src/infra/http/request-helpers';
import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import {
  AddDomainDto,
  TenantDomainDto,
  TenantDomainListDto,
} from './dto/tenant-domain.dto';
import { TenantDomainService } from './tenant-domain.service';
import { AppException } from 'src/infra/errors/app-exception';

/** Owner (dashboard): the venue's own domains for the delivery site. */
@ApiTags('Organization domains')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  type: ErrorResponse,
  description: 'No or invalid owner token',
})
@ApiForbiddenResponse({
  type: ErrorResponse,
  description: 'The user has no organization',
})
@ApiNotFoundResponse({
  type: ErrorResponse,
  description:
    'Not your organization (any other id looks missing); domain_not_found: no such domain of this venue',
})
@Controller('organization')
export class TenantDomainController {
  constructor(private readonly domains: TenantDomainService) {}

  /** Same rule as OrganizationService.assertOwn: another venue's id looks missing. */
  private own(id: string, req: StaffRequest): string {
    const organizationId = requireStaffOrganizationId(req);
    if (id !== organizationId)
      throw new AppException('not_found', {
        message: 'Organization not found',
      });
    return organizationId;
  }

  @Get(':id/domains')
  @ApiOperation({
    summary:
      'Own domains of the venue, its platform address and the primary domain',
  })
  @ApiOkResponse({ type: TenantDomainListDto })
  list(@Param('id') id: string, @Req() req: StaffRequest) {
    return this.domains.list(this.own(id, req));
  }

  @Post(':id/domains')
  @ApiOperation({
    summary:
      'Add a domain. It stays pending (resolves to nobody) until the TXT record check passes; with DOMAIN_VERIFY_SKIP=true (development) it is verified at once',
  })
  @ApiCreatedResponse({ type: TenantDomainDto })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'invalid_host (not a bare domain name), platform_host (the platform domain or under it), reserved_host (localhost, .local, .internal, IP); field in fields[]',
  })
  @ApiConflictResponse({
    type: ErrorResponse,
    description:
      'domain_already_added (this venue has it), domain_taken (verified by another venue)',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponse,
    description: 'domain_limit_reached (details.limit)',
  })
  add(
    @Param('id') id: string,
    @Body() dto: AddDomainDto,
    @Req() req: StaffRequest,
  ) {
    return this.domains.add(this.own(id, req), dto.host);
  }

  @Post(':id/domains/:domainId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Check the TXT record _xmenu-verify.<host> = xmenu-verify=<token>. A verified domain answers as is',
  })
  @ApiOkResponse({ type: TenantDomainDto })
  @ApiConflictResponse({
    type: ErrorResponse,
    description: 'domain_taken: another venue verified this host first',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponse,
    description:
      'domain_verification_failed: details.reason record_not_found | token_mismatch | dns_error, details.record the expected record',
  })
  verify(
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Req() req: StaffRequest,
  ) {
    return this.domains.verify(this.own(id, req), domainId);
  }

  @Delete(':id/domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a domain' })
  @ApiNoContentResponse({ description: 'Removed' })
  remove(
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @Req() req: StaffRequest,
  ) {
    return this.domains.remove(this.own(id, req), domainId);
  }
}
