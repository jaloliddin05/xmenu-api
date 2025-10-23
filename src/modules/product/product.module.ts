import { Module } from '@nestjs/common';
import { ProductService } from './services/product.service';
import { ProductController } from './controllers/product.controller';
import { PrismaModule } from '../_prisma/prisma.module';
import { AdditionalProductService } from './services/additional-product.service';
import { AdditionalProductController } from './controllers/additional-product.controller';

@Module({
  imports:[PrismaModule],
  controllers: [ProductController,AdditionalProductController],
  providers: [ProductService,AdditionalProductService],
  exports:[ProductService,AdditionalProductService]
})
export class ProductModule {}
