import {
  Req,
  Controller,
  Post,
  UseGuards,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import express from 'express';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { LoginDto, SmsCodeDto } from './dto';
import { Public } from './decorators/public.decorator';
import { User } from '../user/models/user.modal';
import { LocalAuthGuard } from './passport-strategies/local/local-auth.guard';
import { RefreshTokenUserGuard } from './passport-strategies/refresh-token-user/refresh-token-user.guard';
import { RegisterOrganizationDto } from '../organization/dto';
import PhoneDto from './dto/phone.dto';


@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

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
  @HttpCode(HttpStatus.CREATED)
  create(@Body() value: RegisterOrganizationDto) {
    return this.authService.signup(value);
  }

  @Public()
  @Post('/check-code')
  @HttpCode(200)
  async checkCode(@Body() data: SmsCodeDto, @Query('token') token: string) {
    return await this.authService.checkCode(token, data.code);
  }

  @Public()
  @Post('/resend-code')
  @HttpCode(200)
  async resendCode(@Body() data: PhoneDto) {
    return await this.authService.resendCode(data.phone);
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
