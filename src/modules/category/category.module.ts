import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './services/category.service';

@Module({
  imports:[PrismaModule],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports:[CategoryService]
})
export class CategoryModule {}
