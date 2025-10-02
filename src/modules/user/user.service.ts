import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../_prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { FileService } from '../file/file.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService,
  ) { }

  async create(data: CreateUserDto) {
    const existingUser = await this.prismaService.user.findUnique({
      where: { phone: data.phone },
    });

    if (existingUser && !existingUser?.isActive) {
      const updatedUser = await this.prismaService.user.update({ where: { id: existingUser.id }, data: { ...data } })
      return updatedUser
    }

    if (existingUser) {
      throw new BadRequestException('Phone already taken');
    }

    return await this.prismaService.user.create({
      data: { ...data },
    });
  }

  async findAll() {
    return await this.prismaService.user.findMany()
  }

  async findOne(id: string) {
    const user = await this.prismaService.user.findUnique({ where: { id }, include: { organization: true } })
    return { ...user, password: null }
  }

  async findById(id: string) {
    const user = await this.prismaService.user.findUnique({ where: { id }, include: { avatar: true } })
    return user
  }

  async findByPhone(phone: string) {
    return await this.prismaService.user.findUnique({
      where: {
        phone
      }
    });
  }

  async update(id: string, data: UpdateUserDto, file?: Express.Multer.File,) {
    const avatar:any = {}
    if (file) {
      const newAvatar = await this.updateImage(file,id);
      avatar.avatar_id = newAvatar.id;
      avatar.url = newAvatar.url;
    }

    return await this.prismaService.user.update({
      where: { id },
      data:{ ...data, ...avatar },
      include: { avatar: true }, // agar file ma'lumotini ham qaytarmoqchi bo'lsangiz
    });
  }

  async updateIsActiveAndPassword(id: string, isActive: boolean, password: string) {
    return await this.prismaService.user.update({ where: { id }, data: { isActive, password } })
  }

  async delete(id: string) {
    return await this.prismaService.user.delete({ where: { id } })
  }

  async uploadImage(file: Express.Multer.File) {
    const image = await this.fileService.uploadFile(file);
    return image;
  }

  async updateImage(file: Express.Multer.File, id: string) {
    const data = await this.findById(id);
    const avatar = await this.fileService.updateFile(data?.avatar?.id || '', file);
    return avatar;
  }

  async deleteImage(id: string) {
    const data = await this.findById(id);
    if (data?.avatar?.url) {
      await this.fileService.removeFile(data.avatar.id);
    }
  }
}
