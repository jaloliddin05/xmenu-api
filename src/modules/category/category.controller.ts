import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    return await this.categoryService.delete(id);
  }
}
