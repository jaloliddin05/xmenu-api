import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../_prisma/prisma.service';
import { ChangePasswordDto, UpdateUserDto } from './dto';
import { FileService } from '../file/file.service';
import { hashPassword } from 'src/infra/helper/auth/hash-password';
import { toStaffUser } from 'src/infra/helper/auth/staff-user';
import { AppException } from 'src/infra/errors/app-exception';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService,
  ) {}

  async findOne(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      include: {
        organization: {
          include: { logo: true, banner: true, translations: true },
        },
      },
    });
    return user ? toStaffUser(user) : null;
  }

  async findById(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      include: { avatar: true },
    });
    return user;
  }

  async findByPhone(phone: string) {
    return await this.prismaService.user.findUnique({
      where: {
        phone,
      },
      include: {
        organization: {
          include: {
            logo: true,
            banner: true,
            translations: true,
          },
        },
      },
    });
  }

  async update(id: string, data: UpdateUserDto, file?: Express.Multer.File) {
    const avatar: { avatar_id?: string; url?: string } = {};
    if (file) {
      const newAvatar = await this.updateImage(file, id);
      avatar.avatar_id = newAvatar.id;
      avatar.url = newAvatar.url;
    }

    const user = await this.prismaService.user.update({
      where: { id },
      // the DTO is looser than the Prisma input type
      data: { ...data, ...avatar } as Prisma.userUncheckedUpdateInput,
      include: { avatar: true }, // agar file ma'lumotini ham qaytarmoqchi bo'lsangiz
    });
    return toStaffUser(user);
  }

  async changePassword(data: ChangePasswordDto, id: string) {
    const user = await this.prismaService.user
      .findUnique({
        where: { id },
      })
      .catch(() => {
        throw new AppException('not_found', { message: 'data not found' });
      });

    const isSamePassword =
      !!user?.password &&
      (await bcrypt.compare(data.oldPassword, user.password));

    if (!isSamePassword) {
      throw new AppException('wrong_password');
    }

    return await this.updatePassword(id, data.newPassword);
  }

  async updatePassword(id: string, password: string) {
    await this.prismaService.user.findUnique({ where: { id } }).catch(() => {
      throw new AppException('not_found', { message: 'user not found' });
    });

    const newPassword = await hashPassword(password);

    return toStaffUser(
      await this.prismaService.user.update({
        where: { id },
        data: { password: newPassword },
      }),
    );
  }

  async delete(id: string) {
    return toStaffUser(await this.prismaService.user.delete({ where: { id } }));
  }

  async updateImage(file: Express.Multer.File, id: string) {
    const data = await this.findById(id);
    const avatar = await this.fileService.updateFile(
      data?.avatar?.id || '',
      file,
    );
    return avatar;
  }

  async deleteImage(id: string) {
    const data = await this.findById(id);
    if (data?.avatar?.url) {
      await this.fileService.removeFile(data.avatar.id);
    }
  }
}
