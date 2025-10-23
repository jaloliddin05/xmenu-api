import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
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
    @HttpCode(HttpStatus.CREATED)
    async createAdditionalProductGroup(
        @Body() dto: CreateAdditionalProductGroupDto,
    ) {
        return await this.additionalProductService.createGroup(dto);
    }

    @Post('/')
    @ApiOperation({ summary: 'Create new additional product' })
    @HttpCode(HttpStatus.CREATED)
    async createAdditionalProduct(
        @Body() dto: CreateAdditionalProductDto,
    ) {
        return await this.additionalProductService.createAdditionalProduct(dto);
    }

    @Delete('/group/:id')
    @ApiOperation({ summary: 'Method: delete' })
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteGroup(@Param('id') id: string) {
        return await this.additionalProductService.deleteGroup(id);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Method: delete' })
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('id') id: string) {
        return await this.additionalProductService.delete(id);
    }
}
