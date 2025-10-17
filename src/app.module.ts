import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from '../config'
import { OrganizationModule } from './modules/organization/organization.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { TranslationModule } from './modules/translation/translation.module';
import { CategoryModule } from './modules/category/category.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { FileModule } from './modules/file/file.module';
import { ProductModule } from './modules/product/product.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
     ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
    }),
    AuthModule,
    CategoryModule,
    FileModule,
    OrganizationModule,
    ProductModule,
    TranslationModule,
    UserModule
  ],
})
export class AppModule {}
