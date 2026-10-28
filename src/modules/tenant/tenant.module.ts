import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TenantService } from './tenant.service';
import { TenantGuard } from './tenant.guard';
import { TenantController } from './tenant.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantService, TenantGuard],
  exports: [TenantService, TenantGuard],
})
export class TenantModule {}
