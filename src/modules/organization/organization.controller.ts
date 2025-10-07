import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationService } from './services/organization.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import UpdateOrganizationDto from './dto/update-organization.dto';

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) { }

  @Get()
  @ApiOperation({ summary: 'Method: get all' })
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return await this.organizationService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Method: get one' })
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.organizationService.findOne(id);
  }

  @Put('/:id')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Method: updating organization' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'banner', maxCount: 1 },
        { name: 'logo', maxCount: 1 },
      ],
      {
        storage: MulterStorage('uploads/image/organization'),
      },
    ),
  )
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() data: UpdateOrganizationDto,
    @UploadedFiles() files: { banner?: Express.Multer.File[]; logo?: Express.Multer.File[] },
    )
    {
    const banner = files?.banner?.[0];
    const logo = files?.logo?.[0];
    return await this.organizationService.update(id, data, logo,banner );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    return await this.organizationService.delete(id);
  }
}
