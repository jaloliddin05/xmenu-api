import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { PrivacyRetentionQueue } from './privacy-retention.queue';
import { PrivacyRetentionService } from './privacy-retention.service';

/** Retention periods of personal data (docs/PRIVACY-FACTS.md); account deletion lives in CustomerModule. */
@Module({
  imports: [PrismaModule],
  providers: [PrivacyRetentionService, PrivacyRetentionQueue],
})
export class PrivacyModule {}
