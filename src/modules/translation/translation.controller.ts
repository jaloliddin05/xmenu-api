import { Controller, Post, Body, HttpCode, HttpStatus, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TranslationService } from './translation.service';
import { TranslationDto } from './dto';
import { RateLimitService } from '../auth/services/rate-limit.service';
import { translationRate } from './translation.limits';

@ApiTags('Translation')
@Controller('translation')
export class TranslationController {
  constructor(
    private readonly translationService: TranslationService,
    private readonly rateLimit: RateLimitService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Translate menu text (owner token required; rate limited per owner, 429 rate_limited)' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() data: TranslationDto, @Req() req) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException();
    const { limit, ttlSeconds } = translationRate();
    await this.rateLimit.hit([{ key: `translation:user:${userId}`, limit, ttlSeconds }]);
    return await this.translationService.translate(data.text, data.promptName);
  }

}
