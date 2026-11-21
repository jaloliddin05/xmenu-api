import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import express from 'express';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { requestCtx } from 'src/infra/http/request-helpers';
import type { StaffSessionRequest } from 'src/infra/http/request-helpers';
import { StaffSessionDto } from '../dto/auth-response.dto';
import { StaffChangePasswordDto } from '../dto/staff-password.dto';
import { StaffPasswordService } from '../services/staff-password.service';
import { StaffSessionService } from '../services/staff-session.service';
import { StaffStepUpDto, StaffStepUpTokenDto } from '../dto/staff-step-up.dto';
import { StaffStepUpService } from '../step-up/staff-step-up.service';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';

type Req = express.Request & StaffSessionRequest;

/** Owner's own account: password change, step-up and the list of logins. Needs an access token. */
@ApiTags('Auth')
@Controller('auth')
export class StaffSessionsController {
  constructor(
    private readonly passwords: StaffPasswordService,
    private readonly sessions: StaffSessionService,
    private readonly stepUp: StaffStepUpService,
  ) {}

  @StaffAccess('account')
  @Post('/step-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm the password once more: the token opens critical actions (payment keys, bot, iiko, deleting the venue or the account) for 5 minutes',
    description:
      'Send the token as X-Step-Up-Token. It is bound to this login (sid) and may be used any number of times until it expires. Wrong passwords: at most 5 per 15 minutes per user, then 429 rate_limited; the login lockout is not affected.',
  })
  @ApiOkResponse({ type: StaffStepUpTokenDto })
  @ApiBadRequestResponse({ description: 'wrong_password, validation_error' })
  @ApiTooManyRequestsResponse({
    description: 'rate_limited with retryAfter: too many wrong passwords',
  })
  issueStepUp(
    @Body() dto: StaffStepUpDto,
    @Req() req: Req,
  ): Promise<StaffStepUpTokenDto> {
    return this.stepUp.issue(
      req.user.id,
      req.user.sid,
      dto.password,
      requestCtx(req),
    );
  }

  @StaffAccess('account')
  @Post('/password/change')
  @ApiOperation({
    summary:
      'Change the password (needs the current one); every other login is revoked',
  })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: StaffChangePasswordDto,
    @Req() req: Req,
  ): Promise<void> {
    await this.passwords.change(
      req.user.id,
      req.user.sid,
      dto,
      requestCtx(req),
    );
  }

  @StaffAccess('account')
  @Get('/sessions')
  @ApiOperation({ summary: 'Active logins of the owner' })
  @ApiOkResponse({ type: StaffSessionDto, isArray: true })
  list(@Req() req: Req) {
    return this.sessions.listActive(req.user.id, req.user.sid);
  }

  @StaffAccess('account')
  @Delete('/sessions/:id')
  @ApiOperation({
    summary: 'End one login; another owner’s or an unknown one is 404',
  })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Req,
  ): Promise<void> {
    await this.sessions.end(req.user.id, id, requestCtx(req));
  }

  @StaffAccess('account')
  @Delete('/sessions')
  @ApiOperation({ summary: 'End every login except the current one' })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async endOthers(@Req() req: Req): Promise<void> {
    await this.sessions.endOthers(req.user.id, req.user.sid, requestCtx(req));
  }
}
