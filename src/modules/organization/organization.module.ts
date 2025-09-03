import { Module } from '@nestjs/common';
import { OrganizationService } from './services/organization.service';
import { OrganizationController } from './organization.controller';
import { PrismaModule } from '../_prisma/prisma.module';

@Module({
  imports:[PrismaModule],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports:[OrganizationService]
})
export class OrganizationModule {}
