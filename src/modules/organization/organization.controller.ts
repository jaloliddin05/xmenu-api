import { BadRequestException, NotFoundException, Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, UseInterceptors, UploadedFiles, Query, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicOrganizationDto } from './dto/public-organization.dto';
import { OrganizationService } from './services/organization.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import UpdateOrganizationDto from './dto/update-organization.dto';
import { Public } from '../auth/decorators/public.decorator';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { isValidSlug, SLUG_RULE } from './domain/slug';

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) { }

  @Get(':id')
  @ApiOperation({ summary: 'Method: get one (your own organization only)' })
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string, @Req() req) {
    const organization = await this.organizationService.findOne(id);
    this.organizationService.assertOwn(organization.id, requireStaffOrganizationId(req));
    return organization;
  }

  @Public()
  @Get('return-slug/:id')
  @ApiOperation({ summary: 'Slug of an active venue by organization id (UUID), as plain text; 404 otherwise' })
  @ApiOkResponse({ schema: { type: 'string', example: 'mant' } })
  @HttpCode(HttpStatus.OK)
  async getSlugById(@Param('id') id: string) {
    const slug = await this.organizationService.findActiveSlug(id);
    if (!slug) throw new NotFoundException('Organization not found');
    return slug;
  }

  @Public()
  @Get('/slug/:slug')
  @ApiOperation({ summary: 'Public QR menu of an active venue (only public fields; 404 for unknown or inactive)' })
  @ApiOkResponse({ type: PublicOrganizationDto })
  @HttpCode(HttpStatus.OK)
  async findOneBySlug(@Param('slug') slug: string, @Query('lang') lang: string) {
    return await this.organizationService.findBySlug(slug,lang);
  }

  @Post('check-slug')
  @ApiOperation({ summary: 'Slug mavjudligini tekshirish' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          example: 'burger-king',
          description: 'Tekshiriladigan slug nomi',
        },
      },
      required: ['slug'],
    },
  })
  async checkSlug(@Body('slug') slug: string) {
    if (!isValidSlug(slug)) throw new BadRequestException({ message: `slug: ${SLUG_RULE}`, code: 'invalid_slug' });
    const exists = await this.organizationService.isSlugExists(slug);
    return { exists };
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
    @Req() req
    )
    {
    const banner = files?.banner?.[0];
    const logo = files?.logo?.[0];
    return await this.organizationService.update(id, requireStaffOrganizationId(req), data, logo,banner, req?.user?.organization?.slug );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req) {
    return await this.organizationService.delete(id, requireStaffOrganizationId(req));
  }
}
