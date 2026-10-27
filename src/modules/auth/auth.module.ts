import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';

import { UserModule } from '../user/user.module';
import { AuthController } from './controllers/auth.controller';
import { ConfigService } from '@nestjs/config';
import { AccessTokenUserStrategy } from './passport-strategies/access-token-user/access-token-user.strategy';
import { LocalStrategy } from './passport-strategies/local/local.strategy';
import { RefreshTokenUserStrategy } from './passport-strategies/refresh-token-user/refresh-token-user.strategy';
import { OrganizationModule } from '../organization/organization.module';
import { JwtTokenService } from './jwt.service';
import { SmsModule } from '../sms/sms.module';
import { AuthService } from './services/auth.service';
import { AuthCustomerController } from './controllers/customer-auth.controller';
import { CustomerAuthService } from './services/customer-auth.service';
import { CustomerModule } from '../customer/customer.module';
import { TenantModule } from '../tenant/tenant.module';
import { PrismaModule } from '../_prisma/prisma.module';
import {
  CUSTOMER_AUTH_CONFIG,
  loadCustomerAuthConfig,
} from './customer-auth.config';
import { CustomerOtpService } from './services/customer-otp.service';
import { CustomerSessionService } from './services/customer-session.service';
import { CustomerTokenService } from './services/customer-token.service';
import { CustomerAuthEventService } from './services/customer-auth-event.service';
import { StaffAuthEventService } from './services/staff-auth-event.service';
import { CustomerCleanupService } from './services/customer-cleanup.service';
import { RateLimitService } from './services/rate-limit.service';
import { TelegramInitDataService } from './services/telegram-init-data.service';
import { CustomerAccessTokenStrategy } from './passport-strategies/customer-access-token/customer-access-token.strategy';
import { NoStoreMiddleware } from './middleware/no-store.middleware';

@Module({
  imports: [
    UserModule,
    OrganizationModule,
    PassportModule,
    CustomerModule,
    TenantModule,
    PrismaModule,
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
    SmsModule,
  ],
  providers: [
    AuthService,
    CustomerAuthService,
    { provide: CUSTOMER_AUTH_CONFIG, useFactory: loadCustomerAuthConfig },
    CustomerOtpService,
    CustomerSessionService,
    CustomerTokenService,
    CustomerAuthEventService,
    StaffAuthEventService,
    CustomerCleanupService,
    RateLimitService,
    TelegramInitDataService,
    CustomerAccessTokenStrategy,
    AccessTokenUserStrategy,
    LocalStrategy,
    RefreshTokenUserStrategy,
    JwtTokenService,
  ],
  controllers: [AuthController, AuthCustomerController],
  exports: [AuthService, CUSTOMER_AUTH_CONFIG],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Mijoz auth javoblari keshlanmasin
    consumer.apply(NoStoreMiddleware).forRoutes('auth/customer', 'customers');
  }
}
