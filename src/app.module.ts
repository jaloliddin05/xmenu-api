import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PublicRateLimitGuard } from './infra/http/public-rate-limit';
import { ConfigModule } from '@nestjs/config';

import configuration from './config';
import { OrganizationModule } from './modules/organization/organization.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { TranslationModule } from './modules/translation/translation.module';
import { CategoryModule } from './modules/category/category.module';
import { FileModule } from './modules/file/file.module';
import { ProductModule } from './modules/product/product.module';
import { ApplicationModule } from './modules/application-form/application.module';
import { BullModule } from '@nestjs/bullmq';
import { SmsModule } from './modules/sms/sms.module';
import { CustomerModule } from './modules/customer/customer.module';
import { RedisModule } from './infra/redis/redis.module';
import { BranchModule } from './modules/branch/branch.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrderModule } from './modules/order/order.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { PaymentModule } from './modules/payment/payment.module';
import { TenantConfigModule } from './modules/tenant/tenant-config.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TenantDomainModule } from './modules/tenant-domain/tenant-domain.module';
import { StaffModule } from './modules/staff/staff.module';
import { PushModule } from './modules/push/push.module';
import { ReportModule } from './modules/report/report.module';
import { PosModule } from './modules/pos/pos.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { HealthModule } from './modules/health/health.module';
import { CspReportModule } from './modules/csp-report/csp-report.module';
import { LiveModule } from './modules/live/live.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
    ApplicationModule,
    AuthModule,
    BranchModule,
    BullModule,
    CategoryModule,
    CspReportModule,
    CustomerModule,
    FileModule,
    HealthModule,
    LiveModule,
    MenuModule,
    OrderModule,
    DeliveryModule,
    OrganizationModule,
    PaymentModule,
    PosModule,
    PrivacyModule,
    ProductModule,
    RedisModule,
    SmsModule,
    TelegramModule,
    TenantConfigModule,
    TenantDomainModule,
    StaffModule,
    PushModule,
    ReportModule,
    TranslationModule,
    UserModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: PublicRateLimitGuard }],
})
export class AppModule {}
