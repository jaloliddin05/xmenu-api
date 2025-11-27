import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ProductService } from '../services/product.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import MoveProductDto from '../dto/move-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { UploadProductImagesDto } from '../dto/product-image.dot';

@ApiTags('Product')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) { }

  @Get()
  @ApiOperation({ summary: 'Method: get all' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'uuid' })
  @ApiQuery({ name: 'isActive', required: false, description: 'true' })
  @ApiQuery({ name: 'title', required: false, description: '' })
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query('lang') lang: string, 
    @Query('categoryId') categoryId: string,
    @Query('is_active') is_active: string,
    @Query('title') title: string,
    @Req() req
  ) {
    return await this.productService.findAll(req?.user?.organization?.id,categoryId, lang,is_active,title);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Method: get one' })
  @HttpCode(HttpStatus.OK)
  async findOne( @Param('id') id: string) {
    return await this.productService.findById(id);
  }


  @Post()
  @ApiOperation({ summary: 'Create new product with translations and options' })
  async create(
    @Body() dto: CreateProductDto,
    @Req() req
  ) {
    return await this.productService.createProduct(dto, req?.user?.organization?.slug);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update existing product' })
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Req() req) {
    return await this.productService.updateProduct(id, dto, req?.user?.organization?.slug);
  }

  @Patch('/index')
  @ApiOperation({ summary: 'Method: update index' })
  @HttpCode(HttpStatus.OK)
  async updateIndex(@Body() data: MoveProductDto, @Req() req) {
    return await this.productService.moveProduct(data,req?.user?.organization?.slug);
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
      required: ['is_active'],
    },
  })
  @HttpCode(HttpStatus.OK)
  async activateProduct(@Param('id') id: string, @Body('is_active') is_active: boolean, @Req() req) {
    return await this.productService.updateIsActive(id, is_active, req?.user?.organization?.slug);
  }

  @Patch('/:id/images')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload images for a product' })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'images', maxCount: 10 }], {
      storage: MulterStorage('uploads/image/products'),
    }),
  )
  @HttpCode(HttpStatus.OK)
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: { images?: Express.Multer.File[] },
    @Body() dto: UploadProductImagesDto
  ) {
    return this.productService.addProductImages(id, files?.images || []);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string,@Req() req) {
    return await this.productService.delete(id,req?.user?.organization?.slug);
  }

  @Delete('/image/:id')
  @ApiOperation({ summary: 'Method: delete image' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(@Param('id') id: string) {
    return await this.productService.deleteImage(id);
  }
}
