import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TenantService } from './tenant.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [PrismaModule],
  providers: [TenantService, TenantGuard],
  exports: [TenantService, TenantGuard],
})
export class TenantModule {}
