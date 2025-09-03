import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { Organization } from '../models/organization.model';
import { CreateOrganizationDto, UpdateOrganizationDto } from '../dto';
import { hashPassword } from 'src/infra/helper';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService:PrismaService
  ){}

  async create(data: CreateOrganizationDto) {
    const password = await hashPassword(data.password)
    return await this.prismaService.organization.create({data:{...data,password}})
  }

  async findAll() {
    return await this.prismaService.organization.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.organization.findUnique({where:{id}})
  }

  async findByPhone(phone: string): Promise<Organization | null> {
    return await this.prismaService.organization.findUnique({
      where: {
        phone
      }
    });
  }

  async update(id: string, data: UpdateOrganizationDto) {
    return await this.prismaService.organization.update({data,where:{id}})
  }

  async delete(id: string) {
    return await this.prismaService.organization.delete({where:{id}})
  }
}
