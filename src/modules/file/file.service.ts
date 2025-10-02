import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../_prisma/prisma.service';

@Injectable()
export class FileService {
  constructor(
    private readonly prismaService:PrismaService
    
  ) {}

  async uploadFile(file: Express.Multer.File) {
    const url = file.path.split('uploads')[1];
    const path = file.path;

    return await this.prismaService.file.create({ data: { url, path } });
  }

  async removeFile(id: string) {
    const file = await this.prismaService.file.findUnique({ where: { id } });
    if (file?.path) {
      await this.deleteFileWithFs(file.path);
    }
    await this.prismaService.file.delete({ where: { id } });
  }

  async updateFile(id: string, file: Express.Multer.File) {
    const changedFile = id
      ? await this.prismaService.file.findUnique({ where: { id } })
      : null;

    if (changedFile?.path) {
      await this.deleteFileWithFs(changedFile.path);
    }

    const url = file.path.split('uploads')[1];
    const path = file.path;

    if (changedFile) {
      changedFile.url = url;
      changedFile.path = path;
      return await this.prismaService.file.update({ where: { id }, data: changedFile });
    } else {
      return await this.prismaService.file.create({ data: { url, path } });
    }
  }

  async deleteFileWithFs(path) {
    try {
      return fs.unlink(path, (err) => {
        if (err) console.log(err);
      });
    } catch (err) {
      console.log(err);
    }
  }
}
