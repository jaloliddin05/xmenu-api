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
import { sendOtpWithButton, sendUserPassword } from 'src/infra/helper/tg-bot/otp-bot';
import { generatePasswordWithHash } from 'src/infra/helper/hash-password';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly jwtTokenService: JwtTokenService,
  ) { }

  async validateUserByUsernamePassword(phone: string, password: string) {
    const user = await this.userService.findByPhone(phone);
  
    if (!user) {
      throw new BadRequestException('Invalid phone.');
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

    const user = await this.userService.create({ first_name: value?.first_name, phone: value.phone, last_name: value?.last_name })
    await this.organizationService.create({ name: value.name, type: value.type }, user.id)

    const code = generateRandomCode(4);

    await sendOtpWithButton(code, value.phone)

    return this.jwtTokenService.generateToken({ code, id: user.id, title: value.name });
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
    const { code: tokenCode, id, title } = await this.jwtTokenService.decodeToken(token);

    if(tokenCode == code){
      const {hash,password} = await generatePasswordWithHash(title)
      await this.organizationService.updateIsActive(id,true)
      const user = await this.userService.updateIsActiveAndPassword(id,true, hash)
      await sendUserPassword(password, user.phone, user.first_name, user.last_name)

      const accessToken = this.getJWT('access', user.id);
      const refreshToken = this.getJWT('refresh', user.id);
      return {success: code == tokenCode, user, accessToken, refreshToken}
    }


    return {success: code == tokenCode};
  }
}
