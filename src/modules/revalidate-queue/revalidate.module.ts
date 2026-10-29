import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { BullConfigService } from './bull.config';
import { RevalidateService } from './revalidate.service';
import { RevalidateProcessor } from './revalidate.processor';

@Module({
  imports: [PrismaModule],
  providers: [BullConfigService, RevalidateService, RevalidateProcessor],
  exports: [RevalidateService],
})
export class RevalidateModule {}
