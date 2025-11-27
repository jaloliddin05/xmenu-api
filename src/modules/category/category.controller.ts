import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, Query, Patch, Req } from '@nestjs/common';
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
  async findAll(@Query('lang') lang: string,@Req() req) {
    return await this.categoryService.findAll(lang,req?.user?.organization?.id);
  }

  @Get('/for-select/:organizationId')
  @ApiOperation({ summary: 'Method: get all for select' })
  @HttpCode(HttpStatus.OK)
  async findAllForSelect(@Query('lang') lang: string,@Param('organizationId') organizationId: string) {
    return await this.categoryService.getForSelect(organizationId,lang);
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
  async create(@Body() data: CreateCategoryDto,@Req() req) {
    return await this.categoryService.createCategory(data,req.user?.organization?.slug);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Method: update' })
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() data: UpdateCategoryDto, @Req() req) {
    return await this.categoryService.update(id, data, req.user?.organization?.slug);
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
      required: ['is_active'],
    },
  })
  @HttpCode(HttpStatus.OK)
  async activateCategory(@Param('id') id: string, @Body('is_active') is_active: boolean, @Req() req) {
    return await this.categoryService.updateIsActive(id, is_active,req.user?.organization?.slug);
  }

  @Patch('/index')
  @ApiOperation({ summary: 'Method: update index' })
  @HttpCode(HttpStatus.OK)
  async updateIndex(@Body() data: MoveCategoryDto, @Req() req) {
    return await this.categoryService.moveCategory(data, req.user?.organization?.slug);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req) {
    return await this.categoryService.delete(id, req.user?.organization?.slug);
  }
}
