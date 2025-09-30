import * as bcrypt from 'bcrypt';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException } from '@nestjs/common/exceptions';
import { ConfigService } from '@nestjs/config';

import { UserService } from '../user/user.service';
import { OrganizationService } from '../organization/services/organization.service';
import { RegisterOrganizationDto } from '../organization/dto';
import { JwtTokenService } from './jwt.service';
import generateRandomCode from 'src/infra/helper/auth/generate-random-code';
import { sendOtpWithButton } from 'src/infra/helper/tg-bot/otp-bot';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly jwtTokenService: JwtTokenService,
  ) { }

  async validateUserByUsernamePassword(login: string, password: string) {
    const user = await this.userService.findByPhone(login);
    if (!user) {
      throw new BadRequestException('Invalid username.');
    }

    const isPasswordSame = await this.comparePasswordWithHash(
      password,
      user?.password,
    );
    if (!isPasswordSame) {
      throw new BadRequestException('Invalid password');
    }
    return user;
  }

  async validateUserById(userId: string) {
    const user = await this.userService.findOne(userId).catch(() => {
      throw new BadRequestException('Valid token with non-existent user.');
    });
    return user;
  }

  async comparePasswordWithHash(password, hash) {
    const isSame = await bcrypt.compare(password, hash);
    return isSame;
  }

  async signup(value: RegisterOrganizationDto) {

    const user = await this.userService.create({ first_name: value?.first_name, phone: value.phone, last_name: value?.last_name }).catch((e) => {
      throw new BadRequestException('Something went wrong from FE');
    })

    await this.organizationService.create({ name: value.name, type: value.type }, user.id)

    const code = generateRandomCode(4);

    await sendOtpWithButton(code, value.phone)

    return this.jwtTokenService.generateToken({ code, id: user.id });
  }

  getJWT(type: 'access' | 'refresh', sub: string) {
    const payload = { sub };

    if (type === 'access') {
      return this.jwtService.sign(payload);
    }

    const jwtConfig = this.configService.getOrThrow('jwt');
    return this.jwtService.sign(payload, {
      secret: jwtConfig.refreshTokenSecret,
      expiresIn: jwtConfig.refreshTokenExpiration,
    });
  }

  async checkCode(token: string, code: number) {
    const { code: tokenCode } = await this.jwtTokenService.decodeToken(token);
    return code == tokenCode;
  }
}
