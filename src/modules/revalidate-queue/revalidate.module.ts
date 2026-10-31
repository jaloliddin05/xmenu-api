import { Module, OnModuleInit } from '@nestjs/common';
import { assertRevalidateConfig } from './revalidate-config';
import { PrismaModule } from '../_prisma/prisma.module';
import { BullConfigService } from './bull.config';
import { RevalidateService } from './revalidate.service';
import { RevalidateProcessor } from './revalidate.processor';

@Module({
  imports: [PrismaModule],
  providers: [BullConfigService, RevalidateService, RevalidateProcessor],
  exports: [RevalidateService],
})
export class RevalidateModule implements OnModuleInit {
  onModuleInit() {
    assertRevalidateConfig();
  }
}
