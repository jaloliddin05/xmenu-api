import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import {
  requestCtx,
  requireStaffOrganizationId,
} from 'src/infra/http/request-helpers';
import type { StaffRequest } from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { InviteStaffDto, StaffMemberDto } from './dto/staff-member.dto';
import { StaffService } from './staff.service';

type Req = StaffRequest & Request;

/** Owner (dashboard, "Сотрудники"): operators of the venue. */
@ApiTags('Organization staff')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  type: ErrorResponse,
  description: 'No or invalid staff token, or the user is disabled',
})
@ApiForbiddenResponse({
  type: ErrorResponse,
  description:
    'forbidden: not the owner (operators have no `staff` permission)',
})
@ApiNotFoundResponse({
  type: ErrorResponse,
  description:
    'Not your organization (any other id looks missing), or no such staff member in it',
})
@Controller('organization')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @StaffAccess('staff', { orgParam: 'id' })
  @Get(':id/staff')
  @ApiOperation({
    summary:
      'Staff of the venue: the owner first, then operators and invitations',
  })
  @ApiOkResponse({ type: [StaffMemberDto] })
  list(@Param('id') _id: string, @Req() req: Req) {
    return this.staff.list(requireStaffOrganizationId(req));
  }

  @StaffAccess('staff', { orgParam: 'id' })
  @Post(':id/staff')
  @ApiOperation({
    summary:
      'Invite an operator by phone (valid 72 h; inviting the phone again restarts it). Nothing is sent: the operator opens the dashboard, gets a code (POST /auth/invitation/code) and sets a password',
  })
  @ApiCreatedResponse({ type: StaffMemberDto })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'invalid_phone, validation_error',
  })
  @ApiConflictResponse({
    type: ErrorResponse,
    description:
      'phone_taken: the phone has a staff account, or an open invitation of another venue',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponse,
    description: 'rate_limited: too many invitations from this venue',
  })
  invite(
    @Param('id') _id: string,
    @Body() dto: InviteStaffDto,
    @Req() req: Req,
  ) {
    return this.staff.invite(
      requireStaffOrganizationId(req),
      req.user.id,
      dto,
      requestCtx(req),
    );
  }

  @StaffAccess('staff', { orgParam: 'id' })
  @Post(':id/staff/:memberId/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Disable an operator (every login ends at once) or cancel an invitation; idempotent. The owner: 403 forbidden',
  })
  @ApiNoContentResponse()
  async disable(
    @Param('id') _id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() req: Req,
  ): Promise<void> {
    await this.staff.disable(
      requireStaffOrganizationId(req),
      memberId,
      requestCtx(req),
    );
  }
}
