import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';

import { UserModule } from '../user/user.module';
import { AuthController } from './controllers/auth.controller';
import { ConfigService } from '@nestjs/config';
import { AccessTokenUserStrategy } from './passport-strategies/access-token-user/access-token-user.strategy'
import { LocalStrategy } from './passport-strategies/local/local.strategy';
import { RefreshTokenUserStrategy } from './passport-strategies/refresh-token-user/refresh-token-user.strategy'
import { OrganizationModule } from '../organization/organization.module';
import { JwtTokenService } from './jwt.service';
import { SmsModule } from '../sms/sms.module';
import { AuthService } from './services/auth.service';
import { AuthCustomerController } from './controllers/customer-auth.controller';
import { CustomerAuthService } from './services/customer-auth.service';
import { CustomerModule } from '../customer/employee.module';

@Module({
  imports: [
    UserModule,
    OrganizationModule,
    PassportModule,
    CustomerModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.getOrThrow('jwt');
        return {
          secret: jwtConfig.accessTokenSecret,
          signOptions: { expiresIn: jwtConfig.accessTokenExpiration },
        };
      },
      inject: [ConfigService],
    }),
    SmsModule
  ],
  providers: [
    AuthService,
    CustomerAuthService,
    AccessTokenUserStrategy,
    LocalStrategy,
    RefreshTokenUserStrategy,
    JwtTokenService,
  ],
  controllers: [AuthController,AuthCustomerController],
  exports: [AuthService],
})
export class AuthModule {}
