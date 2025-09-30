import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prismaService:PrismaService
  ){}

  async create(data: CreateCategoryDto) {
    return await this.prismaService.category.create({data:{...data}})
  }

  async findAll() {
    return await this.prismaService.category.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.category.findUnique({where:{id}})
  }

  async update(id: string, data: UpdateCategoryDto) {
    return await this.prismaService.category.update({data,where:{id}})
  }

  async delete(id: string) {
    return await this.prismaService.category.delete({where:{id}})
  }
}
