import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

import * as crypto from 'crypto';
import generateRandomCode from 'src/infra/helper/auth/generate-random-code';
import { sendOtpWithButton } from 'src/infra/helper/tg-bot/otp-bot';
import { CustomerRepository } from 'src/modules/customer/repositories/customer.repository';
import { JwtTokenService } from '../jwt.service';

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly jwtService: JwtTokenService,
  ) {}

  // =========================
  // PHONE AUTH
  // =========================

  async requestPhoneCode(phone: string) {
    const code = generateRandomCode(4);

    sendOtpWithButton(code, phone);

    return this.jwtService.generateToken({ code });
  }

  async verifyPhone(token: string, code: string, phone: string) {
    const { code: tokenCode } = await this.jwtService.decodeToken(token);

    const isValid = tokenCode == code;

    if (!isValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    let customer = await this.customerRepository.findByPhone(phone);

    if (!customer) {
      customer = await this.customerRepository.create({
        phone,
      });
    }

    return this.generateTokens(customer.id);
  }

  async validateCustomerById(customer_id: string) {
    const customer = await this.customerRepository.findById(customer_id).catch(() => {
      throw new BadRequestException('Valid token with non-existent customer.');
    });
    return customer;
  }

  // =========================
  // TELEGRAM LOGIN
  // =========================

  async telegramLogin(initData: string) {
    const telegramUser = this.verifyTelegramInitData(initData);

    const telegramId = telegramUser.id.toString();

    const customer = await this.customerRepository.findByTelegramId(telegramId);

    if (!customer) {
      return {
        authenticated: false,
        requires_registration: true,
      };
    }

    return {
      authenticated: true,
      ...(await this.generateTokens(customer.id)),
    };
  }

  // =========================
  // TELEGRAM REGISTER
  // =========================

  async registerWithTelegram(initData: string, phone: string) {
    const telegramUser = this.verifyTelegramInitData(initData);

    const telegramId = telegramUser.id.toString();

    // Telegram allaqachon boshqa
    // customerga bog'langanmi?
    const telegramCustomer =
      await this.customerRepository.findByTelegramId(telegramId);

    if (telegramCustomer) {
      return this.generateTokens(telegramCustomer.id);
    }

    // Phone bo'yicha account qidiramiz
    let customer = await this.customerRepository.findByPhone(phone);

    if (customer) {
      // Account bor.
      // Telegram ID ni shu accountga bog'laymiz.

      if (customer.telegram_id) {
        throw new ConflictException(
          'This customer already has a Telegram account',
        );
      }

      customer = await this.customerRepository.update(customer.id, {
        telegram_id: telegramId,
        first_name: customer.first_name ?? telegramUser.first_name,
        last_name: customer.last_name ?? telegramUser.last_name,
      });
    } else {
      // Account yo'q.
      // Yangi customer yaratamiz.

      customer = await this.customerRepository.create({
        phone,
        telegram_id: telegramId,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name,
      });
    }

    return this.generateTokens(customer.id);
  }

  // =========================
  // TOKEN GENERATION
  // =========================

  private async generateTokens(customerId: string) {
    const accessToken = this.jwtService.getJWT(
      'access',
      customerId,
      'customer',
    );

    const refreshToken = this.jwtService.getJWT(
      'refresh',
      customerId,
      'customer',
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // =========================
  // TELEGRAM VERIFICATION
  // =========================

  private verifyTelegramInitData(initData: string) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const params = new URLSearchParams(initData);

    const hash = params.get('hash');

    if (!hash) {
      throw new UnauthorizedException('Telegram hash not found');
    }

    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const hashesEqual = crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hash),
    );

    if (!hashesEqual) {
      throw new UnauthorizedException('Invalid Telegram initData');
    }

    const userString = params.get('user');

    if (!userString) {
      throw new UnauthorizedException('Telegram user not found');
    }

    try {
      return JSON.parse(userString);
    } catch {
      throw new UnauthorizedException('Invalid Telegram user data');
    }
  }
}
