import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './services/category.service';
import { BullModule } from '../revalidate-queue/revalidate.module';

@Module({
  imports:[PrismaModule,BullModule],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports:[CategoryService]
})
export class CategoryModule {}
