import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';

@ApiTags('Application')
@Controller('application')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Method: create' })
  async create(@Body() dto: CreateApplicationDto) {
    return this.applicationService.create(dto);
  }

  @Get()
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Platform admins only (PLATFORM_ADMIN_USER_IDS)' })
  async findAll() {
    return this.applicationService.findAll();
  }
}
