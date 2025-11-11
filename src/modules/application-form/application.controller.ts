import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

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
  async findAll() {
    return this.applicationService.findAll();
  }
}
