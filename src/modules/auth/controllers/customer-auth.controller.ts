import {
  Req,
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CustomerPhoneVerifyDto,
  CustomerTelegramDto,
  CustomerTelegramRegisterDto,
} from '../dto';
import { Public } from '../decorators/public.decorator';
import PhoneDto from '../dto/phone.dto';
import { CustomerAuthService } from '../services/customer-auth.service';

@ApiTags('Auth-Customer')
@Controller('auth-customer')
export class AuthCustomerController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Public()
  @Post('/login')
  @HttpCode(200)
  async login(@Body() data: CustomerTelegramDto) {
    const res = await this.customerAuthService.telegramLogin(data.initData);
    return res;
  }

  @Public()
  @Post('/telegram-register')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() value: CustomerTelegramRegisterDto) {
    return this.customerAuthService.registerWithTelegram(value.initData, value.phone);
  }

  @Public()
  @Post('/check-code')
  @HttpCode(200)
  async checkCode(
    @Body() data: CustomerPhoneVerifyDto,
    @Query('token') token: string,
  ) {
    return await this.customerAuthService.verifyPhone(token, data.code, data.phone);
  }

  @Public()
  @Post('/send-code')
  @HttpCode(200)
  async resendCode(@Body() data: PhoneDto) {
    return await this.customerAuthService.requestPhoneCode(data.phone);
  }
}
