import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileService } from './file.service';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MulterStorage,
  uploadLimits,
} from 'src/infra/helper/upload/multer-upload';
import { fieldError } from 'src/infra/validators/validation-errors';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';

@ApiTags('File')
@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @StaffAccess('profile')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: MulterStorage('uploads/image/products'),
      limits: uploadLimits(1),
    }),
  )
  @HttpCode(HttpStatus.OK)
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw fieldError('file', 'required', 'file is required');
    return await this.fileService.uploadFile(file);
  }
}
