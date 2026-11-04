import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from 'src/infra/validators/error-response.dto';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import {
  applicationRate,
  PublicRateLimit,
} from 'src/infra/http/public-rate-limit';

@ApiTags('Application')
@Controller('application')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Public()
  @PublicRateLimit({ bucket: 'application', rate: applicationRate })
  @Post()
  @ApiOperation({
    summary:
      'Landing contact form (public, 5 requests per hour per IP, invalid ones included, 429 rate_limited); answers { id }',
  })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'validation_error with errors[] (from is required)',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description:
      'rate_limited: 5 requests per hour per IP (requests rejected by validation count too), retryAfter in seconds',
  })
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
