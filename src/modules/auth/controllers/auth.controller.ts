import {
  Req,
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import express from 'express';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { StaffAuthService } from '../services/staff-auth.service';
import { StaffSessionService } from '../services/staff-session.service';
import { LoginDto } from '../dto';
import {
  StaffCheckCodeDto,
  StaffRegisterDto,
  StaffRegistrationRefDto,
} from '../dto/staff-register.dto';
import { Public } from '../decorators/public.decorator';
import { StaffLogoutDto, StaffRefreshDto } from '../dto/staff-session.dto';
import { requestCtx } from 'src/infra/http/request-helpers';


@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly sessions: StaffSessionService,
  ) { }

  @Public()
  @Post('/login')
  @ApiOperation({
    summary: 'Owner login by phone and password (per-phone escalating lockout, per-IP limit)',
  })
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: express.Request) {
    return this.staffAuth.login(dto, requestCtx(req));
  }


  @Public()
  @Post('/register')
  @ApiOperation({
    summary: 'Start owner signup: nothing is stored in the DB until the SMS code is confirmed',
  })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: StaffRegisterDto, @Req() req: express.Request) {
    return this.staffAuth.register(dto, requestCtx(req));
  }

  @Public()
  @Post('/check-code')
  @ApiOperation({ summary: 'Confirm the signup code; creates the owner and the venue and signs in' })
  @HttpCode(200)
  checkCode(@Body() dto: StaffCheckCodeDto, @Req() req: express.Request) {
    return this.staffAuth.checkCode(dto, requestCtx(req));
  }

  @Public()
  @Post('/resend-code')
  @ApiOperation({ summary: 'Send a new signup code (respects the resend cooldown)' })
  @HttpCode(200)
  resendCode(@Body() dto: StaffRegistrationRefDto, @Req() req: express.Request) {
    return this.staffAuth.resendCode(dto.registrationId, requestCtx(req));
  }

  @Public()
  @Post('/refresh')
  @ApiOperation({
    summary: 'New token pair for a refresh token; the old refresh token is spent (rotation). 401 invalid_refresh_token',
  })
  @HttpCode(200)
  refresh(@Body() dto: StaffRefreshDto, @Req() req: express.Request) {
    return this.sessions.refresh(dto.refreshToken, requestCtx(req));
  }

  @Public()
  @Post('/logout')
  @ApiOperation({ summary: 'Revoke the login behind a refresh token (idempotent, always 204)' })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: StaffLogoutDto, @Req() req: express.Request): Promise<void> {
    await this.sessions.logout(dto.refreshToken, requestCtx(req));
  }
}
