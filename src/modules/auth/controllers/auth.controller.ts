import {
  Req,
  Controller,
  Post,
  UseGuards,
  Body,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import express from 'express';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from '../services/auth.service';
import { StaffAuthService } from '../services/staff-auth.service';
import { LoginDto } from '../dto';
import {
  StaffCheckCodeDto,
  StaffRegisterDto,
  StaffRegistrationRefDto,
} from '../dto/staff-register.dto';
import { Public } from '../decorators/public.decorator';
import { User } from '../../user/models/user.modal';
import { LocalAuthGuard } from '../passport-strategies/local/local-auth.guard';
import { RefreshTokenUserGuard } from '../passport-strategies/refresh-token-user/refresh-token-user.guard';
import { requestCtx } from 'src/infra/http/request-helpers';


@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly staffAuth: StaffAuthService,
  ) { }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('/login')
  @HttpCode(200)
  async login(
    @Req() { user }: { user: User },
    @Res({ passthrough: true }) response: express.Response,
    @Body() _: LoginDto,
  ) {
    const accessToken = this.authService.getJWT('access', user.id);
    const refreshToken = this.authService.getJWT('refresh', user.id);
    return { accessToken, refreshToken, user };
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
  @UseGuards(RefreshTokenUserGuard)
  @Post('/refresh')
  @HttpCode(200)
  @ApiNoContentResponse({
    description: 'New access, refresh tokens have been saved.',
  })
  @ApiForbiddenResponse({ description: 'Unauthorized Request' })
  async refresh(
    @Req() { user }: { user: User },
    @Res({ passthrough: true }) response: express.Response,
  ) {
    const accessToken = this.authService.getJWT('access', user.id);
    const refreshToken = this.authService.getJWT('refresh', user.id);
    return { accessToken, refreshToken };
  }
}
