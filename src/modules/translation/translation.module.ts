import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';

@Module({
  imports:[PrismaModule, AuthModule],
  controllers: [TranslationController],
  providers: [TranslationService],
  exports:[TranslationService]
})
export class TranslationModule {}
