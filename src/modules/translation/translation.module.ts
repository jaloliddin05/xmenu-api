import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';

@Module({
  imports:[PrismaModule],
  controllers: [TranslationController],
  providers: [TranslationService],
  exports:[TranslationService]
})
export class TranslationModule {}
