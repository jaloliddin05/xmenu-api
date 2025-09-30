import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../_prisma/prisma.service';
import { User } from './models/user.modal';
import { hashPassword } from 'src/infra/helper';
import { CreateUserDto, UpdateUserDto } from './dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService:PrismaService
  ){}

  async create(data: CreateUserDto) {
   const existingUser = await this.prismaService.user.findUnique({
      where: { phone: data.phone },
    });

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
    return await this.prismaService.user.findUnique({where:{id}})
  }

  async findByPhone([phone]: string): Promise<User | null> {
    return await this.prismaService.user.findUnique({
      where: {
        phone
      }
    });
  }

  async update(id: string, data: UpdateUserDto) {
    return await this.prismaService.user.update({data,where:{id}})
  }

  async delete(id: string) {
    return await this.prismaService.user.delete({where:{id}})
  }
}
