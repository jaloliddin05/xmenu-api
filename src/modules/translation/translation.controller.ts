import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TranslationService } from './translation.service';
import { TranslationDto } from './dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Translation')
@Controller('translation')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) { }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Method: create' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() data: TranslationDto) {
    return await this.translationService.translate(data.text,data.promptName);
  }

}
