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
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import { fieldError } from 'src/infra/validators/validation-errors';

@ApiTags('File')
@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: MulterStorage('uploads/image/products'),
    }),
  )
  @HttpCode(HttpStatus.OK)
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw fieldError('file', 'required', 'file is required');
    return await this.fileService.uploadFile(file);
  }
}
