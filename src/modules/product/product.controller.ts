import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UploadedFiles,
    UseInterceptors,
    UsePipes,
    ValidationPipe
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ProductService } from './services/product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import MoveProductDto from './dto/move-product.dto';
import { CreateAdditionalProductGroupDto } from './dto/additional-product.dto';

@ApiTags('Products')
@Controller('products')
export class ProductController {
    constructor(private readonly productService: ProductService) { }

    @Get()
    @ApiOperation({ summary: 'Method: get all' })
    @ApiQuery({ name: 'categoryId', required: false, description: 'uuid' })
    @HttpCode(HttpStatus.OK)
    async findAll(@Query('lang') lang: string, @Query('categoryId') categroryId: string) {
        return await this.productService.findAll(categroryId, lang);
    }


    @Post()
    @ApiOperation({ summary: 'Create new product with translations and options' })
    async create(
        @Body() dto: CreateProductDto,
    ) {
        return await this.productService.createProduct(dto);
    }

    @Post('/additional-product-group')
    @ApiOperation({ summary: 'Create new additional product group' })
    async createGroup(
        @Body() dto: CreateAdditionalProductGroupDto,
    ) {
        return await this.productService.createGroup(dto);
    }

    @Patch('/index')
    @ApiOperation({ summary: 'Method: update index' })
    @HttpCode(HttpStatus.OK)
    async updateIndex(@Body() data: MoveProductDto) {
        return await this.productService.moveProduct(data);
    }

      @Patch(':id/activate')
      @ApiOperation({ summary: 'Method: activate/deactivate product' })
      @ApiBody({
        schema: {
          type: 'object',
          properties: {
            isActive: {
              type: 'boolean',
              example: true,
              description: 'Set true to activate, false to deactivate product',
            },
          },
          required: ['isActive'],
        },
      })
      @HttpCode(HttpStatus.OK)
      async activateProduct(@Param('id') id: string, @Body('isActive') isActive: boolean) {
        return await this.productService.updateIsActive(id, isActive);
      }
}
