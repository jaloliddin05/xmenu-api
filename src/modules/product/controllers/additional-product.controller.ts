import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';
import { AdditionalProductService } from '../services/additional-product.service';

@ApiTags('Additional-Product')
@Controller('additional-product')
export class AdditionalProductController {
  constructor(private readonly additionalProductService: AdditionalProductService) { }

  @Post('/group')
  @ApiOperation({ summary: 'Create new additional product group' })
  async createAdditionalProductGroup(
    @Body() dto: CreateAdditionalProductGroupDto,
  ) {
    return await this.additionalProductService.createGroup(dto);
  }

  @Post('/')
  @ApiOperation({ summary: 'Create new additional product' })
  async createAdditionalProduct(
    @Body() dto: CreateAdditionalProductDto,
  ) {
    return await this.additionalProductService.createAdditionalProduct(dto);
  }
}
