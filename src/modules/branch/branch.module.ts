import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { BranchAdminController } from './branch-admin.controller';
import { BranchController } from './branch.controller';
import { BranchService } from './services/branch.service';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [BranchController, BranchAdminController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
