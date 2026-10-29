import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config'
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
import { PaymentModule } from './modules/payment/payment.module';
import { TenantConfigModule } from './modules/tenant/tenant-config.module';
import { TelegramModule } from './modules/telegram/telegram.module';
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
    CustomerModule,
    FileModule,
    MenuModule,
    OrderModule,
    OrganizationModule,
    PaymentModule,
    ProductModule,
    RedisModule,
    SmsModule,
    TelegramModule,
    TenantConfigModule,
    TranslationModule,
    UserModule
  ],
})
export class AppModule {}
