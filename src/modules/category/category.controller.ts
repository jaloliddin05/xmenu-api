import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, Query, Patch } from '@nestjs/common';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from './dto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryService } from './services/category.service';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) { }

  @Get()
  @ApiOperation({ summary: 'Method: get all' })
  @HttpCode(HttpStatus.OK)
  async findAll(@Query('lang') lang: string) {
    return await this.categoryService.findAll(lang);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Method: get one' })
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.categoryService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Method: create' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() data: CreateCategoryDto) {
    return await this.categoryService.createCategory(data);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Method: update' })
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() data: UpdateCategoryDto) {
    return await this.categoryService.update(id, data);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Method: activate/deactivate category' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isActive: {
          type: 'boolean',
          example: true,
          description: 'Set true to activate, false to deactivate category',
        },
      },
      required: ['isActive'],
    },
  })
  @HttpCode(HttpStatus.OK)
  async activateCategory(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return await this.categoryService.updateIsActive(id, isActive);
  }

  @Patch('/index')
  @ApiOperation({ summary: 'Method: update index' })
  @HttpCode(HttpStatus.OK)
  async updateIndex(@Body() data: MoveCategoryDto) {
    return await this.categoryService.moveCategory(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    return await this.categoryService.delete(id);
  }
}
