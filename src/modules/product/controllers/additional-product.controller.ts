import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Put,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';
import { AdditionalProductService } from '../services/additional-product.service';
import { UpdateAdditionalProductDto, UpdateAdditionalProductGroupDto } from '../dto/update-additional-product.dto';

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

    @Put("group/:id")
    @ApiOperation({ summary: "Update additional product group" })
    async updateGroup(
        @Param("id") id: string,
        @Body() dto: UpdateAdditionalProductGroupDto
    ) {
        return this.additionalProductService.updateGroup(id, dto);
    }

    // ✅ UPDATE ADDITIONAL PRODUCT
    @Put(":id")
    @ApiOperation({ summary: "Update additional product" })
    async updateAdditionalProduct(
        @Param("id") id: string,
        @Body() dto: UpdateAdditionalProductDto
    ) {
        return this.additionalProductService.updateAdditionalProduct(id, dto);
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
