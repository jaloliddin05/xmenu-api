import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { CreateBranchDto, CreateHoursExceptionDto, SetWorkingHoursDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchService } from './services/branch.service';

/**
 * Restoran paneli uchun filial boshqaruvi. Xodim tokeni (global guard); tenant
 * doim tokendagi organization'dan olinadi, URL/body'dan emas.
 */
@ApiTags('Branch')
@Controller('branch')
export class BranchAdminController {
  constructor(private readonly branches: BranchService) {}

  @Get()
  @ApiOperation({ summary: 'Barcha filiallar (yashirinlari ham) jadvali bilan' })
  list(@Req() req) {
    return this.branches.listAdmin(requireStaffOrganizationId(req));
  }

  @Post()
  @ApiOperation({ summary: 'Filial yaratish' })
  create(@Body() dto: CreateBranchDto, @Req() req) {
    return this.branches.create(requireStaffOrganizationId(req), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Filial maydonlarini o'zgartirish (isActive=false — yashirish)" })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto, @Req() req) {
    return this.branches.update(requireStaffOrganizationId(req), id, dto);
  }

  @Put(':id/working-hours')
  @ApiOperation({ summary: "Haftalik ish jadvalini to'liq almashtirish" })
  setWorkingHours(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWorkingHoursDto, @Req() req) {
    return this.branches.setWorkingHours(requireStaffOrganizationId(req), id, dto);
  }

  @Post(':id/exceptions')
  @ApiOperation({ summary: "Sana uchun istisno (bayram, ta'mir) qo'shish/yangilash" })
  addException(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateHoursExceptionDto, @Req() req) {
    return this.branches.addException(requireStaffOrganizationId(req), id, dto);
  }

  @Delete(':id/exceptions/:exceptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Istisnoni o'chirish" })
  async removeException(@Param('id', ParseUUIDPipe) id: string, @Param('exceptionId', ParseUUIDPipe) exceptionId: string, @Req() req) {
    await this.branches.removeException(requireStaffOrganizationId(req), id, exceptionId);
  }

  @Delete(':id')
  @ApiOperation({ summary: "O'chirish (buyurtmasi bor filial faqat yashiriladi)" })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.branches.remove(requireStaffOrganizationId(req), id);
  }
}
