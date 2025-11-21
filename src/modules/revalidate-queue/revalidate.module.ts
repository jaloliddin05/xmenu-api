import { Module } from '@nestjs/common';
import { BullConfigService } from './bull.config';
import { RevalidateService } from './revalidate.service';
import { RevalidateProcessor } from './revalidate.processor';

@Module({
  imports: [],
  providers: [BullConfigService, RevalidateService, RevalidateProcessor],
  exports: [RevalidateService],
})
export class BullModule {}
