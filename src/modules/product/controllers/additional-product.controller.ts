import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Put,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';
import { AdditionalProductService } from '../services/additional-product.service';
import { UpdateAdditionalProductDto, UpdateAdditionalProductGroupDto } from '../dto/update-additional-product.dto';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';

@ApiTags('Additional-Product')
@Controller('additional-product')
export class AdditionalProductController {
    constructor(private readonly additionalProductService: AdditionalProductService) { }

    @Post('/group')
    @ApiOperation({ summary: 'Create new additional product group' })
    @HttpCode(HttpStatus.CREATED)
    async createAdditionalProductGroup(
        @Body() dto: CreateAdditionalProductGroupDto,
        @Req() req
    ) {
        return await this.additionalProductService.createGroup(dto, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }

    @Post('/')
    @ApiOperation({ summary: 'Create new additional product' })
    @HttpCode(HttpStatus.CREATED)
    async createAdditionalProduct(
        @Body() dto: CreateAdditionalProductDto,
        @Req() req
    ) {
        return await this.additionalProductService.createAdditionalProduct(dto, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }

    @Put("group/:id")
    @ApiOperation({ summary: "Update additional product group" })
    async updateGroup(
        @Param("id") id: string,
        @Body() dto: UpdateAdditionalProductGroupDto,
        @Req() req
    ) {
        return this.additionalProductService.updateGroup(id, dto, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }

    // ✅ UPDATE ADDITIONAL PRODUCT
    @Put(":id")
    @ApiOperation({ summary: "Update additional product" })
    async updateAdditionalProduct(
        @Param("id") id: string,
        @Body() dto: UpdateAdditionalProductDto,
        @Req() req
    ) {
        return this.additionalProductService.updateAdditionalProduct(id, dto, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }

    @Delete('/group/:id')
    @ApiOperation({ summary: 'Method: delete' })
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteGroup(@Param('id') id: string, @Req() req) {
        return await this.additionalProductService.deleteGroup(id, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Method: delete' })
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('id') id: string, @Req() req) {
        return await this.additionalProductService.delete(id, requireStaffOrganizationId(req), req?.user?.organization?.slug);
    }
}
