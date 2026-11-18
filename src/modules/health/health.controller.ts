import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { HealthDto, ReadinessDto } from './health.dto';
import { HealthService } from './health.service';

/** Health checks for the container runtime and the proxy; never part of a front-end flow. */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Liveness: the process answers (no database or Redis call)',
  })
  @ApiOkResponse({ type: HealthDto })
  live(): HealthDto {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Readiness: the database and Redis answer. 503 with the same body when one of them does not',
  })
  @ApiOkResponse({ type: ReadinessDto })
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessDto> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
