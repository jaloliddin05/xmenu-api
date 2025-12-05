import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileService } from "./file.service";
import { Controller, HttpCode, HttpStatus, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Public } from "../auth/decorators/public.decorator";
import { MulterStorage } from "src/infra/helper/upload/multer-upload";

@ApiTags('File')
@Controller('file')
export class FileController {
    constructor(private readonly fileService: FileService) { }

    @Public()
    @Post('upload')
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: MulterStorage('uploads/image/products'),
        }),
    )
    @HttpCode(HttpStatus.OK)
    async uploadFile(@UploadedFile() file: Express.Multer.File) {      
        return await this.fileService.uploadFile(file);
    }
}